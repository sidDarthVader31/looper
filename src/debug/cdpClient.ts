import WebSocket from 'ws';
import * as http from 'http';

interface PendingCall {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
}

export interface CdpStackFrame {
  functionName: string;
  url: string;
  line: number;
  column: number;
}

export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingCall>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    this.ws.on('message', (data) => this.handleMessage(data.toString()));
  }

  static async fetchWebSocketUrl(port: number, host = '127.0.0.1'): Promise<string> {
    const body: string = await new Promise((resolve, reject) => {
      http
        .get({ host, port, path: '/json/list' }, (res) => {
          let data = '';
          res.on('data', (d) => (data += d));
          res.on('end', () => resolve(data));
        })
        .on('error', reject);
    });
    const targets = JSON.parse(body) as Array<{ webSocketDebuggerUrl: string }>;
    if (!targets.length) throw new Error(`No inspectable targets found on port ${port}`);
    return targets[0].webSocketDebuggerUrl;
  }

  static async connect(wsUrl: string): Promise<CdpClient> {
    const ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    return new CdpClient(ws);
  }

  private send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private handleMessage(raw: string): void {
    const msg = JSON.parse(raw);
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) reject(msg.error);
      else resolve(msg.result);
    }
  }

  async enableProfiling(): Promise<void> {
    await this.send('Profiler.enable');
    await this.send('Runtime.enable');
    await this.send('Debugger.enable');
    await this.send('Profiler.setSamplingInterval', { interval: 200 }); // microseconds
  }

  async startSamplingWindow(): Promise<void> {
    await this.send('Profiler.start');
  }

  /**
   * Stops the current sampling window, extracts the leaf call frame for every
   * sample V8 took, and immediately opens a new window so no time is lost
   * between windows. Call this on a timer (e.g. every 300ms) for a "live"
   * call-stack feed.
   */
  async rotateSamplingWindow(): Promise<CdpStackFrame[]> {
    const result = await this.send<{ profile: any }>('Profiler.stop');
    await this.send('Profiler.start');
    const profile = result.profile;
    const nodesById = new Map<number, any>();
    for (const node of profile.nodes) nodesById.set(node.id, node);
    const frames: CdpStackFrame[] = (profile.samples || []).map((nodeId: number) => {
      const node = nodesById.get(nodeId);
      const cf = node?.callFrame;
      return {
        functionName: cf?.functionName || '(anonymous)',
        url: cf?.url || '',
        line: (cf?.lineNumber ?? -1) + 1,
        column: (cf?.columnNumber ?? -1) + 1,
      };
    });
    return frames;
  }

  /** Used for "attach to running process": eval's the agent's own source inside the live process. */
  async injectAgentSource(source: string, port: number): Promise<void> {
    const wrapped = `
      (function() {
        process.env.EVENTLOOP_VIZ_PORT = '${port}';
        ${source}
      })();
    `;
    await this.send('Runtime.evaluate', { expression: wrapped, includeCommandLineAPI: true });
  }

  dispose(): void {
    this.ws.close();
  }
}
