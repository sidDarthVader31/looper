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

export async function launchAndInstrument(options: LaunchOptions): Promise<LaunchResult> {
  const [cmd, ...args] = options.command.split(' ');
  const inspectPort = await findFreePort();

  const child = cp.spawn(cmd, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      NODE_OPTIONS: `--require ${options.agentPath} --inspect=${inspectPort}`,
      EVENTLOOP_VIZ_PORT: String(options.vizPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (d) => console.log(`[target] ${d}`));
  child.stderr?.on('data', (d) => console.log(`[target] ${d}`));

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
