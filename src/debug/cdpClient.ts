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

interface ProfileNode {
  id: number;
  parent?: number;
  callFrame?: {
    functionName?: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
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
    // 10ms sampling interval (was 200µs) — still plenty for a live stack view,
    // without generating multi‑MB profiles every rotation window.
    await this.send('Profiler.setSamplingInterval', { interval: 10000 });
  }

  async startSamplingWindow(): Promise<void> {
    await this.send('Profiler.start');
  }

  /** Reads performance.now() inside the target process (same clock as async_hooks agent). */
  async getTargetPerformanceNow(): Promise<number> {
    const result = await this.send<{ result: { value?: number } }>('Runtime.evaluate', {
      expression: 'performance.now()',
      returnByValue: true,
    });
    return result.result?.value ?? 0;
  }

  /**
   * Stops the current sampling window, walks the parent chain of the most
   * recent sample to rebuild a true call stack (root → leaf), and immediately
   * opens a new window so no time is lost between windows.
   */
  async rotateSamplingWindow(): Promise<CdpStackFrame[]> {
    const result = await this.send<{ profile: any }>('Profiler.stop');
    await this.send('Profiler.start');
    const profile = result.profile;
    const samples: number[] = profile.samples || [];
    if (!samples.length) return [];

    const nodesById = new Map<number, ProfileNode>();
    for (const node of profile.nodes as ProfileNode[]) nodesById.set(node.id, node);

    const leafId = samples[samples.length - 1];
    const chain: CdpStackFrame[] = [];
    let current: ProfileNode | undefined = nodesById.get(leafId);
    while (current) {
      const cf = current.callFrame;
      const url = cf?.url || '';
      const functionName = cf?.functionName || '(anonymous)';
      // Skip idle / root / native frames that have no useful location
      if (functionName !== '(root)' && functionName !== '(idle)' && functionName !== '(program)') {
        chain.push({
          functionName,
          url,
          line: (cf?.lineNumber ?? -1) + 1,
          column: (cf?.columnNumber ?? -1) + 1,
        });
      }
      current = current.parent != null ? nodesById.get(current.parent) : undefined;
    }

    // V8 walks leaf → root; reverse so the UI shows root at top / leaf at bottom
    chain.reverse();
    return chain;
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
