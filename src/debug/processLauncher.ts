import * as cp from 'child_process';
import * as net from 'net';
import { CdpClient } from './cdpClient';

export interface LaunchOptions {
  command: string;
  cwd: string;
  agentPath: string; // absolute path to dist/agent/instrument.js
  vizPort: number; // port AgentServer is listening on
}

export interface LaunchResult {
  child: cp.ChildProcess;
  cdp: CdpClient;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const address = srv.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function pollForInspector(port: number, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = async () => {
      try {
        await CdpClient.fetchWebSocketUrl(port);
        resolve();
      } catch {
        if (Date.now() - start > timeoutMs) {
          reject(new Error('Timed out waiting for the Node inspector to come up.'));
        } else {
          setTimeout(tryOnce, 200);
        }
      }
    };
    tryOnce();
  });
}

/**
 * Split a shell-like command into argv, respecting single/double quotes.
 * Example: `node "my app.js" --flag` → ['node', 'my app.js', '--flag']
 */
export function parseCommandLine(command: string): string[] {
  const result: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        current += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current) {
        result.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) result.push(current);
  return result;
}

export async function launchAndInstrument(options: LaunchOptions): Promise<LaunchResult> {
  const argv = parseCommandLine(options.command);
  if (!argv.length) {
    throw new Error('Launch command is empty.');
  }
  let [cmd, ...args] = argv;
  const inspectPort = await findFreePort();

  const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
  const agentRequire = `--require ${options.agentPath}`;
  const inspectFlag = `--inspect=${inspectPort}`;

  // npm/npx apply NODE_OPTIONS to the npm CLI itself, which fights over the
  // inspect port with the script. Prefer --node-options so only the app gets them.
  const basename = cmd.replace(/\.cmd$/i, '').toLowerCase();
  const isNpmLike = basename === 'npm' || basename === 'npx';
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    EVENTLOOP_VIZ_PORT: String(options.vizPort),
  };

  if (isNpmLike) {
    const nodeOpts = [agentRequire, inspectFlag].join(' ');
    args = [...args, `--node-options=${nodeOpts}`];
  } else {
    env.NODE_OPTIONS = [agentRequire, inspectFlag, existingNodeOptions].filter(Boolean).join(' ');
  }

  const child = cp.spawn(cmd, args, {
    cwd: options.cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d) => console.log(`[target] ${d}`));
  child.stderr?.on('data', (d) => console.log(`[target] ${d}`));

  child.on('error', (err) => {
    console.error(`[target] failed to start: ${err.message}`);
  });

  await pollForInspector(inspectPort);
  const wsUrl = await CdpClient.fetchWebSocketUrl(inspectPort);
  const cdp = await CdpClient.connect(wsUrl);
  await cdp.enableProfiling();
  await cdp.startSamplingWindow();

  return { child, cdp };
}

export async function attachAndInstrument(
  inspectPort: number,
  agentSource: string,
  vizPort: number
): Promise<CdpClient> {
  const wsUrl = await CdpClient.fetchWebSocketUrl(inspectPort);
  const cdp = await CdpClient.connect(wsUrl);
  await cdp.enableProfiling();
  await cdp.injectAgentSource(agentSource, vizPort);
  await cdp.startSamplingWindow();
  return cdp;
}
