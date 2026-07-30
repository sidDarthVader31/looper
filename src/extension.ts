import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { ChildProcess } from 'child_process';
import { AgentServer } from './transport/agentServer';
import { EventStore } from './stateStore';
import { EventLoopPanel } from './webview/panel';
import { launchAndInstrument, attachAndInstrument } from './debug/processLauncher';
import { CdpClient } from './debug/cdpClient';
import { VizEvent } from './shared/types';

const LAST_COMMAND_KEY = 'eventLoopViz.lastLaunchCommand';

let agentServer: AgentServer | undefined;
let store: EventStore | undefined;
let samplingTimer: NodeJS.Timeout | undefined;
let activeCdp: CdpClient | undefined;
let activeChild: ChildProcess | undefined;
let activePanel: EventLoopPanel | undefined;
/** targetNow ≈ hostNow + clockSkew */
let clockSkew = 0;
let samplingInFlight = false;
let lastStackKey = '';
let sessionRunning = false;

export function activate(context: vscode.ExtensionContext): void {
  const agentPath = path.join(context.extensionPath, 'dist', 'agent', 'instrument.js');

  context.subscriptions.push(
    vscode.commands.registerCommand('eventLoopViz.launch', async () => {
      const command = await pickLaunchCommand(context);
      if (!command) return;
      const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? process.cwd();

      await teardown({ notifyPanel: false });
      store = new EventStore();
      agentServer = new AgentServer();
      const vizPort = await agentServer.start();

      const panel = EventLoopPanel.createOrShow(context.extensionUri);
      activePanel = panel;
      // Accept agent events immediately — app bootstrap must not be dropped.
      sessionRunning = true;
      panel.postSessionStart();
      wireReplayControls(panel);

      agentServer.on('event', (event: VizEvent) => {
        if (!sessionRunning) return;
        store?.append(event);
        panel.postEvent(event);
      });

      try {
        vscode.window.showInformationMessage(`Launching "${command}" with visualizer attached...`);
        const { child, cdp } = await launchAndInstrument({ command, cwd, agentPath, vizPort });
        if (!sessionRunning) {
          // User stopped during launch
          try {
            child.kill('SIGTERM');
          } catch {
            /* ignore */
          }
          cdp.dispose();
          return;
        }
        activeCdp = cdp;
        activeChild = child;

        child.on('exit', () => {
          if (sessionRunning) {
            void stopSession('Process exited');
          }
        });

        await calibrateClock(cdp);
        startStackSampling(cdp, panel, child.pid ?? 0);
        await context.globalState.update(LAST_COMMAND_KEY, command);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to launch visualizer: ${message}`);
        await teardown({ notifyPanel: true });
      }
    }),

    vscode.commands.registerCommand('eventLoopViz.attach', async () => {
      const portStr = await vscode.window.showInputBox({
        prompt: 'Inspector port of the already-running Node.js process',
        value: '9229',
        validateInput: (v) => (/^\d+$/.test(v.trim()) ? undefined : 'Enter a numeric port'),
      });
      if (!portStr) return;

      await teardown({ notifyPanel: false });
      store = new EventStore();
      agentServer = new AgentServer();
      const vizPort = await agentServer.start();

      const panel = EventLoopPanel.createOrShow(context.extensionUri);
      activePanel = panel;
      sessionRunning = true;
      panel.postSessionStart();
      wireReplayControls(panel);

      agentServer.on('event', (event: VizEvent) => {
        if (!sessionRunning) return;
        store?.append(event);
        panel.postEvent(event);
      });

      try {
        const agentSource = fs.readFileSync(agentPath, 'utf8');
        const cdp = await attachAndInstrument(Number(portStr), agentSource, vizPort);
        if (!sessionRunning) {
          cdp.dispose();
          return;
        }
        activeCdp = cdp;

        vscode.window.showInformationMessage(
          'Attached. Note: only activity from this point forward will be visualized.'
        );

        await calibrateClock(cdp);
        startStackSampling(cdp, panel, 0);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Failed to attach visualizer: ${message}`);
        await teardown({ notifyPanel: true });
      }
    }),

    vscode.commands.registerCommand('eventLoopViz.stop', async () => {
      await stopSession('Stopped');
    })
  );
}

async function stopSession(reason?: string): Promise<void> {
  if (!sessionRunning && !activeChild && !activeCdp) {
    return;
  }
  sessionRunning = false;

  if (samplingTimer) {
    clearInterval(samplingTimer);
    samplingTimer = undefined;
  }
  samplingInFlight = false;
  lastStackKey = '';

  if (activeChild && !activeChild.killed) {
    try {
      activeChild.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  activeChild = undefined;

  activeCdp?.dispose();
  activeCdp = undefined;

  agentServer?.stop();
  agentServer = undefined;

  activePanel?.postSessionStopped();
  if (reason) {
    vscode.window.showInformationMessage(`Event Loop Visualizer: ${reason}. Replay is still available.`);
  }
}

async function pickLaunchCommand(context: vscode.ExtensionContext): Promise<string | undefined> {
  const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  const last = context.globalState.get<string>(LAST_COMMAND_KEY);
  const active = vscode.window.activeTextEditor?.document;
  const suggestions: { label: string; description?: string; command: string }[] = [];

  if (active && !active.isUntitled && active.uri.scheme === 'file') {
    const ext = path.extname(active.uri.fsPath).toLowerCase();
    if (['.js', '.mjs', '.cjs', '.ts'].includes(ext)) {
      const rel = cwd ? path.relative(cwd, active.uri.fsPath) : active.uri.fsPath;
      const safeRel = rel.includes(' ') ? `"${rel}"` : rel;
      if (ext === '.ts') {
        suggestions.push({
          label: `npx tsx ${safeRel}`,
          description: 'Active TypeScript file',
          command: `npx tsx ${safeRel}`,
        });
      } else {
        suggestions.push({
          label: `node ${safeRel}`,
          description: 'Active editor file',
          command: `node ${safeRel}`,
        });
      }
    }
  }

  if (cwd) {
    const sibling = path.resolve(cwd, '..', 'sample-app', 'main.js');
    if (fs.existsSync(sibling)) {
      suggestions.push({
        label: `node ${sibling}`,
        description: 'sample-app/main.js',
        command: `node ${sibling}`,
      });
    }

    const demoRel = 'fixtures/event-loop-demo.js';
    if (fs.existsSync(path.join(cwd, demoRel))) {
      suggestions.push({
        label: `node ${demoRel}`,
        description: 'Built-in demo',
        command: `node ${demoRel}`,
      });
    }
    try {
      const pkgPath = path.join(cwd, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
          main?: string;
          scripts?: Record<string, string>;
        };
        if (pkg.main) {
          suggestions.push({
            label: `node ${pkg.main}`,
            description: 'package.json main',
            command: `node ${pkg.main}`,
          });
        }
        for (const name of ['start', 'dev']) {
          if (pkg.scripts?.[name]) {
            suggestions.push({
              label: `npm run ${name}`,
              description: pkg.scripts[name],
              command: `npm run ${name}`,
            });
          }
        }
      }
    } catch {
      // ignore malformed package.json
    }
  }

  if (last && !suggestions.some((s) => s.command === last)) {
    suggestions.push({ label: last, description: 'Last used', command: last });
  }

  suggestions.push({ label: 'Enter custom command…', command: '__custom__' });

  const picked = await vscode.window.showQuickPick(
    suggestions.map((s) => ({
      label: s.label,
      description: s.description,
      command: s.command,
    })),
    {
      title: 'Event Loop Visualizer: Launch',
      placeHolder: 'Choose what to run (or enter a custom node command)',
    }
  );
  if (!picked) return undefined;

  if (picked.command !== '__custom__') return picked.command;

  return vscode.window.showInputBox({
    prompt: 'Command to launch your Node.js app',
    value: last ?? 'node index.js',
    placeHolder: 'node app.js   or   npm start',
    validateInput: (v) => (v.trim() ? undefined : 'Enter a command'),
  });
}

async function calibrateClock(cdp: CdpClient): Promise<void> {
  const hostBefore = performance.now();
  const targetNow = await cdp.getTargetPerformanceNow();
  const hostAfter = performance.now();
  const hostMid = (hostBefore + hostAfter) / 2;
  clockSkew = targetNow - hostMid;
}

function startStackSampling(cdp: CdpClient, panel: EventLoopPanel, processId: number): void {
  samplingTimer = setInterval(async () => {
    if (!sessionRunning || samplingInFlight) return;
    samplingInFlight = true;
    try {
      const frames = await cdp.rotateSamplingWindow();
      if (!frames.length || !sessionRunning) return;
      const key = frames.map((f) => `${f.functionName}:${f.line}`).join('|');
      if (key === lastStackKey) return;
      lastStackKey = key;
      const ts = performance.now() + clockSkew;
      const event: VizEvent = { kind: 'stack', frames, ts, processId };
      store?.append(event);
      panel.postEvent(event);
    } catch {
      // keep interval alive
    } finally {
      samplingInFlight = false;
    }
  }, 500);
}

function wireReplayControls(panel: EventLoopPanel): void {
  panel.onControlMessage = (msg) => {
    if (msg.command === 'stop') {
      void stopSession('Stopped');
      return;
    }
    if (msg.command === 'clear') {
      // Timeline only — never kill the child, CDP, or agent socket.
      store?.clear();
      panel.postCleared();
      return;
    }
    if (msg.command === 'liveMode') {
      return;
    }
  };
}

async function teardown(opts?: { notifyPanel?: boolean }): Promise<void> {
  sessionRunning = false;
  if (samplingTimer) {
    clearInterval(samplingTimer);
    samplingTimer = undefined;
  }
  samplingInFlight = false;
  lastStackKey = '';
  clockSkew = 0;

  if (activeChild && !activeChild.killed) {
    try {
      activeChild.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  activeChild = undefined;

  activeCdp?.dispose();
  activeCdp = undefined;
  agentServer?.stop();
  agentServer = undefined;
  store = undefined;

  if (opts?.notifyPanel) {
    activePanel?.postSessionStopped();
  }
}

export function deactivate(): void {
  void teardown({ notifyPanel: false });
}
