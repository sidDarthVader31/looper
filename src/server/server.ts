import * as net from 'net';
import { OutputChannel } from 'vscode';
async function startTcpServer(outputChannel : OutputChannel): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      outputChannel.appendLine('[TCP] Async hooks client connected');
      let buffer = "";

      socket.on('data', (chunk) => {
        buffer +=chunk.toString();
        let index;
        while((index = buffer.indexOf("\n")) >=0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index+1);

          try {
            const evt = JSON.parse(line);
            buffer = buffer.slice(index+1);
            outputChannel.appendLine(`[ASYNC] ${evt.type} -> ${JSON.stringify(evt)}`);
          }
          catch(err: any) {
            outputChannel.appendLine(`failed to parse: ${err.message}`);
          }
        }
      });// socket.on
      socket.on('close', ()=> outputChannel.appendLine("[TCP]  client disconnected")); 
    });
    server.listen(0,"127.0.0.1", ()=> {
      const port = (server.address() as any).port;
      outputChannel.appendLine(`[TCP] listening on port:${port}`);
      resolve(port);
    });
  });
}

export default startTcpServer;
