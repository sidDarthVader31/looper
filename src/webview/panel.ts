import * as vscode from 'vscode';
import { ExtensionToWebviewMessage, WebviewToExtensionMessage, VizEvent } from '../shared/types';

export class EventLoopPanel {
  public static current: EventLoopPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  public onControlMessage?: (msg: WebviewToExtensionMessage) => void;

  static createOrShow(extensionUri: vscode.Uri): EventLoopPanel {
    if (EventLoopPanel.current) {
      EventLoopPanel.current.panel.reveal();
      return EventLoopPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'eventLoopVisualizer',
      'Event Loop Visualizer',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'media')],
        retainContextWhenHidden: true,
      }
    );
    EventLoopPanel.current = new EventLoopPanel(panel, extensionUri);
    return EventLoopPanel.current;
  }

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this.panel = panel;
    this.panel.webview.html = this.buildHtml(extensionUri);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (msg: WebviewToExtensionMessage) => this.onControlMessage?.(msg),
      null,
      this.disposables
    );
  }

  postEvent(event: VizEvent): void {
    const msg: ExtensionToWebviewMessage = { command: 'event', event };
    this.panel.webview.postMessage(msg);
  }

  reset(): void {
    this.panel.webview.postMessage({ command: 'reset' } as ExtensionToWebviewMessage);
  }

  postSessionStart(): void {
    this.panel.webview.postMessage({ command: 'sessionStart' } as ExtensionToWebviewMessage);
  }

  postSessionStopped(): void {
    this.panel.webview.postMessage({ command: 'sessionStopped' } as ExtensionToWebviewMessage);
  }

  postCleared(): void {
    this.panel.webview.postMessage({ command: 'cleared' } as ExtensionToWebviewMessage);
  }

  private buildHtml(extensionUri: vscode.Uri): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'media', 'style.css'));
    const nonce = String(Date.now());
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>Event Loop Visualizer</title>
</head>
<body>
  <header id="toolbar" role="toolbar" aria-label="Playback controls">
    <button type="button" id="btn-live" class="tb-btn is-selected" title="Follow live events" aria-pressed="true">
      <span class="tb-icon" aria-hidden="true">●</span> Live
    </button>
    <button type="button" id="btn-stop" class="tb-btn tb-danger" title="Stop process and freeze timeline" disabled>
      <span class="tb-icon" aria-hidden="true">■</span> Stop
    </button>
    <button type="button" id="btn-clear" class="tb-btn" title="Clear timeline only — process keeps running" disabled>
      Clear
    </button>
    <span class="tb-sep" aria-hidden="true"></span>
    <button type="button" id="btn-step-back" class="tb-btn" title="Previous event" disabled>
      <span class="tb-icon" aria-hidden="true">‹</span>
    </button>
    <button type="button" id="btn-play" class="tb-btn" title="Play / Pause" disabled aria-pressed="false">
      <span class="tb-icon" id="play-icon" aria-hidden="true">▶</span>
      <span id="play-label">Play</span>
    </button>
    <button type="button" id="btn-step-fwd" class="tb-btn" title="Next event" disabled>
      <span class="tb-icon" aria-hidden="true">›</span>
    </button>
    <label class="speed-wrap" title="Replay speed">
      <select id="speed" aria-label="Replay speed">
        <option value="1">1×</option>
        <option value="0.5">0.5×</option>
        <option value="0.25" selected>0.25×</option>
        <option value="0.1">0.1×</option>
      </select>
    </label>
    <input id="scrub" type="range" min="0" max="1000" value="1000" disabled aria-label="Timeline scrubber" />
    <span id="time-readout" aria-live="polite">0.00s / 0.00s</span>
  </header>

  <div id="empty" class="empty-state">
    <p class="empty-title">Event Loop Visualizer</p>
    <p class="empty-hint">Use <strong>Launch &amp; Visualize</strong> or <strong>Attach to Running Process</strong> to start a session.</p>
  </div>

  <div id="viz" class="viz hidden" aria-hidden="true">
    <div id="columns">
      <section id="callstack-col" class="lane lane-stack">
        <div class="lane-head">
          <div class="lane-title">
            <span class="lane-dot" aria-hidden="true"></span>
            <h2>Call stack</h2>
          </div>
          <span class="count" id="callstack-count">0</span>
        </div>
        <div class="lane-body">
          <ol id="callstack-list" class="item-list"></ol>
          <div class="lane-empty" id="callstack-empty">— empty —</div>
        </div>
      </section>
      <section id="microtask-col" class="lane lane-micro">
        <div class="lane-head">
          <div class="lane-title">
            <span class="lane-dot" aria-hidden="true"></span>
            <h2>Microtask queue</h2>
          </div>
          <span class="count" id="microtask-count">0</span>
        </div>
        <div class="lane-body">
          <ol id="microtask-list" class="item-list"></ol>
          <div class="lane-empty" id="microtask-empty">— empty —</div>
        </div>
      </section>
      <section id="macrotask-col" class="lane lane-macro">
        <div class="lane-head">
          <div class="lane-title">
            <span class="lane-dot" aria-hidden="true"></span>
            <h2>Macrotask queue</h2>
          </div>
          <span class="count" id="macrotask-count">0</span>
        </div>
        <div class="lane-body">
          <ol id="macrotask-list" class="item-list"></ol>
          <div class="lane-empty" id="macrotask-empty">— empty —</div>
        </div>
      </section>
    </div>
    <div id="timeline-wrap">
      <canvas id="timeline" height="80" aria-label="Event timeline"></canvas>
    </div>
  </div>

  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    EventLoopPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
