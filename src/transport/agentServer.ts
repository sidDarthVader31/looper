import * as net from 'net';
import { EventEmitter } from 'events';
import { VizEvent } from '../shared/types';

export class AgentServer extends EventEmitter {
  private server: net.Server;
  private _port = 0;

  constructor() {
    super();
    this.server = net.createServer((socket) => this.handleConnection(socket));
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server.address();
        this._port = typeof address === 'object' && address ? address.port : 0;
        resolve(this._port);
      });
    });
  }

  get port(): number {
    return this._port;
  }

  stop(): void {
    this.server.close();
  }

  private handleConnection(socket: net.Socket): void {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as VizEvent;
          this.emit('event', event);
        } catch {
          // ignore malformed line
        }
      }
    });
    socket.on('error', () => {
      // agent disconnected unexpectedly -- ignore, next connection will resume the stream
    });
  }
}
