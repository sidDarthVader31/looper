import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { performance } from 'perf_hooks';
import { AgentServer } from './transport/agentServer';
import { EventStore } from './stateStore';
import { EventLoopPanel } from './webview/panel';
import { launchAndInstrument, attachAndInstrument } from './debug/processLauncher';
import { VizEvent } from './shared/types';

let agentServer: AgentServer | undefined;
let store: EventStore | undefined;
let samplingTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const agentPath = path.join(context.extensionPath, 'dist', 'agent', 'instrument.js');

  context.subscriptions.push(
    vscode.commands.registerCommand('eventLoopViz.launch', async () => {
      const command = await vscode.window.showInputBox({
        prompt: 'Command to launch your Node.js app',
        value: 'node index.js',
      });
      if (!command) return;
      const cwd = vscode.workspace.workspaceFolders?.[0].uri.fsPath ?? process.cwd();

      await teardown();
      store = new EventStore();
      agentServer = new AgentServer();
      const vizPort = await agentServer.start();

      const panel = EventLoopPanel.createOrShow(context.extensionUri);
      agentServer.on('event', (event: VizEvent) => {
        store?.append(event);
        panel.postEvent(event);
      });

      vscode.window.showInformationMessage(`Launching "${command}" with visualizer attached...`);
      const { cdp } = await launchAndInstrument({ command, cwd, agentPath, vizPort });

      samplingTimer = setInterval(async () => {
        try {
          const frames = await cdp.rotateSamplingWindow();
          if (frames.length) {
            const event: VizEvent = { kind: 'stack', frames, ts: performance.now(), processId: 0 };
            store?.append(event);
            panel.postEvent(event);
          }
        } catch {
          // profiler window rotation failed once -- keep the interval alive and retry next tick
        }
      }, 300);

      wireReplayControls(panel);
    }),

    vscode.commands.registerCommand('eventLoopViz.attach', async () => {
      const portStr = await vscode.window.showInputBox({
        prompt: 'Inspector port of the already-running Node.js process',
        value: '9229',
      });
      if (!portStr) return;

      await teardown();
      store = new EventStore();
      agentServer = new AgentServer();
      const vizPort = await agentServer.start();

      const panel = EventLoopPanel.createOrShow(context.extensionUri);
      agentServer.on('event', (event: VizEvent) => {
        store?.append(event);
        panel.postEvent(event);
      });

      const agentSource = fs.readFileSync(agentPath, 'utf8');
      const cdp = await attachAndInstrument(Number(portStr), agentSource, vizPort);

      vscode.window.showInformationMessage(
        'Attached. Note: only activity from this point forward will be visualized.'
      );

      samplingTimer = setInterval(async () => {
        try {
          const frames = await cdp.rotateSamplingWindow();
          if (frames.length) {
            const event: VizEvent = { kind: 'stack', frames, ts: performance.now(), processId: 0 };
            store?.append(event);
            panel.postEvent(event);
          }
        } catch {
          // ignore transient rotation errors
        }
      }, 300);

      wireReplayControls(panel);
    })
  );
}

function wireReplayControls(panel: EventLoopPanel): void {
  panel.onControlMessage = (msg) => {
    if (!store) return;
    if (msg.command === 'seek') {
      const events = store.getRange(0, msg.ts);
      panel.reset();
      for (const e of events) panel.postEvent(e);
    }
    // 'play' / 'pause' / 'liveMode' are handled client-side in main.js
    // against the events already streamed to the webview.
  };
}

async function teardown(): Promise<void> {
  if (samplingTimer) clearInterval(samplingTimer);
  agentServer?.stop();
  agentServer = undefined;
  store = undefined;
}

export function deactivate(): void {
  void teardown();
}
