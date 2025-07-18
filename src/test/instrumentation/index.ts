
// instrumentation/index.ts
// This file runs inside the user's Node.js application process.

import * as async_hooks from 'async_hooks';
import WebSocket from 'ws'; // Using default import for 'ws'

// Define a type for the event data being sent to the VS Code extension
interface EventLoopEvent {
    type: string;
    timestamp: number;
    asyncId?: number;
    resourceType?: string;
    triggerAsyncId?: number;
    stack?: string;
    message?: string;
    details?: string;
}

// Get port from environment variable, default to 8080
const WS_PORT: number = parseInt(process.env.VSCODE_EVENT_LOOP_PORT || '8080', 10);
const ws: WebSocket = new WebSocket(`ws://localhost:${WS_PORT}`);

// Stores information about active async resources
const resourceMap: Map<number, { type: string; stack: string | undefined; initTimestamp: number }> = new Map();

/**
 * Sends an event object to the VS Code extension via WebSocket.
 * @param event The event object to send.
 */
function sendEvent(event: EventLoopEvent): void {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
    }
}

ws.onopen = () => {
    console.log('[ELV Instrumentation] Connected to VS Code Event Loop Visualizer extension.');
    sendEvent({ type: 'status', message: 'connected', timestamp: Date.now() });
};

ws.onerror = (error: Error) => {
    console.error('[ELV Instrumentation] WebSocket error:', error.message);
    sendEvent({ type: 'status', message: 'error', details: error.message, timestamp: Date.now() });
};

ws.onclose = () => {
    console.log('[ELV Instrumentation] Disconnected from VS Code Event Loop Visualizer extension.');
    sendEvent({ type: 'status', message: 'disconnected', timestamp: Date.now() });
};

// Create an AsyncHook instance
const asyncHook = async_hooks.createHook({
    /**
     * Called when a new asynchronous resource is initialized.
     * @param asyncId The unique ID of the asynchronous resource.
     * @param type The type of the asynchronous resource (e.g., 'Timeout', 'Promise', 'FsReqCallback').
     * @param triggerAsyncId The async ID of the resource that caused this resource to be initialized.
     * @param resource The actual resource object.
     */
    init(asyncId: number, type: string, triggerAsyncId: number, resource: object): void {
        // Capture a stack trace when the resource is initialized
        const stack = new Error().stack;
        const event: EventLoopEvent = {
            asyncId,
            type: 'init',
            resourceType: type,
            triggerAsyncId,
            timestamp: Date.now(),
            stack: stack ? stack.split('\n').slice(1).join('\n') : 'No stack' // Clean up stack trace
        };
        resourceMap.set(asyncId, { type, stack, initTimestamp: event.timestamp });
        sendEvent(event);
    },

    /**
     * Called just before an asynchronous resource's callback is executed.
     * @param asyncId The unique ID of the asynchronous resource.
     */
    before(asyncId: number): void {
        const resourceInfo = resourceMap.get(asyncId);
        if (resourceInfo) {
            const event: EventLoopEvent = {
                asyncId,
                type: 'before',
                resourceType: resourceInfo.type,
                timestamp: Date.now(),
            };
            sendEvent(event);
        }
    },

    /**
     * Called just after an asynchronous resource's callback has finished executing.
     * @param asyncId The unique ID of the asynchronous resource.
     */
    after(asyncId: number): void {
        const resourceInfo = resourceMap.get(asyncId);
        if (resourceInfo) {
            const event: EventLoopEvent = {
                asyncId,
                type: 'after',
                resourceType: resourceInfo.type,
                timestamp: Date.now(),
            };
            sendEvent(event);
        }
    },

    /**
     * Called when an asynchronous resource is destroyed.
     * @param asyncId The unique ID of the asynchronous resource.
     */
    destroy(asyncId: number): void {
        const resourceInfo = resourceMap.get(asyncId);
        if (resourceInfo) {
            const event: EventLoopEvent = {
                asyncId,
                type: 'destroy',
                resourceType: resourceInfo.type,
                timestamp: Date.now(),
            };
            sendEvent(event);
            resourceMap.delete(asyncId); // Remove from map once destroyed
        }
    },

    /**
     * Called when a Promise is resolved or rejected.
     * @param asyncId The unique ID of the Promise resource.
     */
    promiseResolve(asyncId: number): void {
        const resourceInfo = resourceMap.get(asyncId);
        if (resourceInfo) {
            const event: EventLoopEvent = {
                asyncId,
                type: 'promiseResolve',
                resourceType: resourceInfo.type, // This will typically be 'PROMISE'
                timestamp: Date.now(),
            };
            sendEvent(event);
        }
    }
});

// Enable the hook to start tracking asynchronous operations
asyncHook.enable();

// Keep the process alive while WebSocket is connecting/active
// This is a common pattern in Node.js instrumentation to ensure the module
// doesn't cause the process to exit prematurely if it's the only thing
// keeping the event loop busy.
process.on('beforeExit', () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        console.log('[ELV Instrumentation] Keeping process alive for WebSocket connection.');
        // This setTimeout is a common trick to ensure the event loop doesn't
        // become empty and exit if there's no other pending work, allowing
        // the WebSocket connection to persist.
        setTimeout(() => {}, 1000);
    }
});

console.log('[ELV Instrumentation] Async hooks enabled. Waiting for WebSocket connection...');

// Export an empty object, as this module is primarily for side effects (instrumentation)
export {};
