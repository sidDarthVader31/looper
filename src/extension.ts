// // The module 'vscode' contains the VS Code extensibility API
// // Import the module and reference it with the alias vscode in your code below
// import * as vscode from 'vscode';
// import { printHello } from './lib/test';
//
// // This method is called when your extension is activated
// // Your extension is activated the very first time the command is executed
// export function activate(context: vscode.ExtensionContext) {
//
// 	// Use the console to output diagnostic information (console.log) and errors (console.error)
// 	// This line of code will only be executed once when your extension is activated
// 	console.log('Congratulations, your extension "looper" is now active!');
//
// 	// The command has been defined in the package.json file
// 	// Now provide the implementation of the command with registerCommand
// 	// The commandId parameter must match the command field in package.json
// 	const disposable = vscode.commands.registerCommand('looper.helloWorld', () => {
// 		// The code you place here will be executed every time your command is executed
// 		// Display a message box to the user
// 		// vscode.window.showInformationMessage('Hello World from looper! we are live');
//     printHello();
// 	});
//   const check1 = vscode.commands.registerCommand('looper.monitor', () => {
//     vscode.window.showInformationMessage("monitoring event loop");
//   });
//
// 	context.subscriptions.push(disposable);
//   context.subscriptions.push(check1);
// }
//
// // This method is called when your extension is deactivated
// export function deactivate() {}

// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { WebSocketServer, WebSocket } from 'ws';

let webviewPanel: vscode.WebviewPanel | undefined;
let wss: WebSocketServer | undefined;
let wsClient: WebSocket | undefined; // To hold the connection from the Node.js app

const WS_PORT = 8080; // Fixed port for simplicity. In a real app, make this dynamic.

export function activate(context: vscode.ExtensionContext) {
    console.log('Node.js Event Loop Visualizer extension is active!');

    // Command to open the visualization panel
    let disposable = vscode.commands.registerCommand('eventLoopVisualizer.start', () => {
        if (webviewPanel) {
            webviewPanel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        webviewPanel = vscode.window.createWebviewPanel(
            'eventLoopVisualizer',
            'Node.js Event Loop',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'src', 'webview'))]
            }
        );

        webviewPanel.webview.html = getWebviewContent(context);

        webviewPanel.onDidDispose(() => {
            webviewPanel = undefined;
            // Optionally close WebSocket server if no panels are open
            // For now, we keep it running to allow re-connections
        }, null, context.subscriptions);

        // Handle messages from the webview (e.g., for user interactions)
        webviewPanel.webview.onDidReceiveMessage(message => {
            console.log('Message from webview:', message);
            // You can send commands back to the Node.js app if needed
        }, null, context.subscriptions);

        startWebSocketServer();
    });

    context.subscriptions.push(disposable);

    // Register the DebugConfigurationProvider to inject instrumentation
    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider('node', new EventLoopDebugConfigurationProvider(context))
    );
}

export function deactivate() {
    console.log('Node.js Event Loop Visualizer extension is deactivated.');
    if (wss) {
        wss.close();
        wss = undefined;
    }
    if (wsClient) {
        wsClient.close();
        wsClient = undefined;
    }
}

function startWebSocketServer() {
    if (wss) {
        console.log('WebSocket server already running.');
        return;
    }

    wss = new WebSocketServer({ port: WS_PORT });

    wss.on('listening', () => {
        console.log(`WebSocket server listening on port ${WS_PORT}`);
        vscode.window.showInformationMessage(`Event Loop Visualizer: Waiting for Node.js app connection on port ${WS_PORT}`);
    });

    wss.on('connection', (ws) => {
        console.log('Node.js app connected to WebSocket server!');
        wsClient = ws; // Store the client connection

        ws.on('message', (message) => {
            try {
                const event = JSON.parse(message.toString());
                // console.log('Received event from Node.js app:', event);

                if (webviewPanel) {
                    // Send the event to the webview for visualization
                    webviewPanel.webview.postMessage({ command: 'event', data: event });
                }
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        });

        ws.on('close', () => {
            console.log('Node.js app disconnected from WebSocket server.');
            wsClient = undefined;
            if (webviewPanel) {
                webviewPanel.webview.postMessage({ command: 'status', data: 'disconnected' });
            }
        });

        ws.on('error', (error) => {
            console.error('WebSocket client error:', error);
            wsClient = undefined;
            if (webviewPanel) {
                webviewPanel.webview.postMessage({ command: 'status', data: 'error' });
            }
        });

        if (webviewPanel) {
            webviewPanel.webview.postMessage({ command: 'status', data: 'connected' });
        }
    });

    wss.on('error', (error: Error) => {
        console.error('WebSocket server error:', error);
        vscode.window.showErrorMessage(`Event Loop Visualizer: WebSocket server error: ${error.message}`);
        wss = undefined; // Reset server on error
    });
}

// Helper to get the HTML content for the webview
function getWebviewContent(context: vscode.ExtensionContext): string {
    const webviewPath = vscode.Uri.file(
        path.join(context.extensionPath, 'src', 'webview', 'index.html')
    );
    const fileContent = vscode.workspace.fs.readFileSync(webviewPath).toString();

    // Replace placeholders for script and style URIs if necessary
    // For now, assuming relative paths within the webview folder
    const scriptUri = webviewPanel?.webview.asWebviewUri(vscode.Uri.file(
        path.join(context.extensionPath, 'src', 'webview', 'index.js') // Assuming you might add a separate JS file later
    ));
    const styleUri = webviewPanel?.webview.asWebviewUri(vscode.Uri.file(
        path.join(context.extensionPath, 'src', 'webview', 'style.css') // Assuming you might add a separate CSS file later
    ));

    // You might want to replace these with actual URIs if you externalize JS/CSS
    return fileContent
        .replace(/{{scriptUri}}/g, scriptUri ? scriptUri.toString() : '')
        .replace(/{{styleUri}}/g, styleUri ? styleUri.toString() : '');
}


// Debug Configuration Provider to inject the instrumentation
class EventLoopDebugConfigurationProvider implements vscode.DebugConfigurationProvider {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Massage a debug configuration just before a debug session is being launched.
     * (Called by VS Code when a debug session is about to start)
     */
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {

        // Only apply to Node.js debug configurations
        if (config.type === 'node') {
            // Ensure runtimeArgs exists
            if (!config.runtimeArgs) {
                config.runtimeArgs = [];
            }

            // Get the absolute path to your instrumentation module
            const instrumentationPath = path.join(this.context.extensionPath, 'out', 'instrumentation', 'index.js'); // NOTE: path changed to 'out/instrumentation' for compiled TS

            // Add the -r (require) flag to load your instrumentation module
            // This ensures it runs before the user's application code
            if (!config.runtimeArgs.includes('-r')) {
                config.runtimeArgs.unshift('-r', instrumentationPath);
            } else {
                // If -r already exists, find its position and insert your module path
                const rIndex = config.runtimeArgs.indexOf('-r');
                config.runtimeArgs.splice(rIndex + 1, 0, instrumentationPath);
            }

            // Pass the WebSocket port to the Node.js application via environment variable
            if (!config.env) {
                config.env = {};
            }
            config.env.VSCODE_EVENT_LOOP_PORT = WS_PORT.toString();

            vscode.window.showInformationMessage(`Event Loop Visualizer: Injected instrumentation into Node.js debug session. Connecting to port ${WS_PORT}.`);
        }

        return config;
    }
}

