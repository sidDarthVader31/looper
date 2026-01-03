import * as vscode from "vscode";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";

let output = vscode.window.createOutputChannel("Looper");
let tcpPort = 0;

/* ============================================================
   ACTIVATE
============================================================ */
export function activate(context: vscode.ExtensionContext) {
  console.log("Looper extension activated");

  const disposable = vscode.commands.registerCommand("looper.runApp", async () => {
    output.show(true);
    output.appendLine("Starting Looper...");

    // 1. Start TCP server (extension side)
    tcpPort = await startTcpServer();

    // 2. Generate agent file (preload script)
    const agentPath = await writeAgentFile(context);

    // 3. Launch the user's app in a terminal with NODE_OPTIONS
    runNodeApp(agentPath);
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}


/* ============================================================
   STEP 1 — Create looper-agent.js dynamically
============================================================ */
async function writeAgentFile(context: vscode.ExtensionContext): Promise<string> {
  const agentCode = `
    const ah = require('async_hooks');
    const net = require('net');

    const client = new net.Socket();
    client.connect(${tcpPort}, "127.0.0.1");

    function send(evt) {
      try {
        client.write(JSON.stringify(evt) + "\\n");
      } catch (_) {}
    }

    ah.createHook({
      init(id, type, trigger) {
        send({ type: 'init', id, resource: type, trigger });
      },
      before(id) {
        send({ type: 'before', id });
      },
      after(id) {
        send({ type: 'after', id });
      },
      destroy(id) {
        send({ type: 'destroy', id });
      }
    }).enable();
  `;

  // Ensure folder exists
  fs.mkdirSync(context.globalStorageUri.fsPath, { recursive: true });

  const agentPath = path.join(context.globalStorageUri.fsPath, "looper-agent.js");
  fs.writeFileSync(agentPath, agentCode, "utf8");

  output.appendLine(`[AGENT] Created at: ${agentPath}`);

  return agentPath;
}


/* ============================================================
   STEP 2 — TCP server (extension side)
============================================================ */
async function startTcpServer(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      output.appendLine("[TCP] Async hooks client connected");

      let buffer = "";

      socket.on("data", (chunk) => {
        buffer += chunk.toString();

        let index;
        while ((index = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);

          try {
            const evt = JSON.parse(line);
            output.appendLine(`[ASYNC] ${evt.type} → ${JSON.stringify(evt)}`);
          } catch (err: any) {
            output.appendLine("Failed to parse: " + err.message);
          }
        }
      });

      socket.on("close", () => output.appendLine("[TCP] Client disconnected"));
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      output.appendLine(`[TCP] Listening on port ${port}`);
      resolve(port);
    });
  });
}


/* ============================================================
   STEP 3 — Launch the user's app in a VS Code terminal
============================================================ */
function runNodeApp(agentPath: string) {
  const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!root) {
    vscode.window.showErrorMessage("No workspace folder found.");
    return;
  }

  const quotedAgent = `"${agentPath}"`;

  const terminal = vscode.window.createTerminal({
    name: "Looper App",
    env: {
      ...process.env,
      NODE_OPTIONS: `--require ${quotedAgent}`
    }
  });

  terminal.show(true);

  // Hardcoded for PoC as requested
  terminal.sendText(`node server.js`);

  output.appendLine("[APP] Node app launched with preload agent.");
  output.appendLine(`Agent path: ${agentPath}`);
}
