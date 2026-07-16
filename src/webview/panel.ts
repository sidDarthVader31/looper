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
  <div id="toolbar">
    <button id="btn-live">Live</button>
    <button id="btn-play">Play</button>
    <button id="btn-pause">Pause</button>
    <input id="scrub" type="range" min="0" max="1000" value="1000" />
  </div>
  <div id="columns">
    <section id="callstack-col">
      <h2>Call stack</h2>
      <ol id="callstack-list"></ol>
    </section>
    <section id="microtask-col">
      <h2>Microtask queue</h2>
      <ol id="microtask-list"></ol>
    </section>
    <section id="macrotask-col">
      <h2>Macrotask queue</h2>
      <ol id="macrotask-list"></ol>
    </section>
  </div>
  <canvas id="timeline" height="80"></canvas>
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
