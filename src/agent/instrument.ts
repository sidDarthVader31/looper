'use strict';

const net = require('net');
const async_hooks = require('async_hooks');
const { performance } = require('perf_hooks');

const PORT = process.env.EVENTLOOP_VIZ_PORT ? Number(process.env.EVENTLOOP_VIZ_PORT) : null;
const VERBOSE = process.env.EVENTLOOP_VIZ_VERBOSE === '1';

if (!PORT) {
  // No visualizer configured for this run -- stay completely inert.
  module.exports = {};
  return;
}

// Only these resource types by default -- this is the set that maps to the
// "microtask queue" (PROMISE, TickObject) and "macrotask queue" (Timeout, Immediate)
// mental model. Set EVENTLOOP_VIZ_VERBOSE=1 to also see TCPWRAP, TLSWRAP, etc.
const TRACKED_TYPES = VERBOSE ? null : new Set(['PROMISE', 'Timeout', 'Immediate', 'TickObject']);

const AGENT_FILE = __filename;

let socket = null;
let connected = false;
const outbox = [];

function connect() {
  socket = net.connect({ host: '127.0.0.1', port: PORT }, () => {
    connected = true;
    while (outbox.length) socket.write(outbox.shift());
  });
  socket.on('error', () => {
    // Visualizer panel isn't open / not listening -- never crash the host app.
    connected = false;
  });
  socket.on('close', () => {
    connected = false;
    socket = null;
  });
}

connect();

function send(obj) {
  const line = JSON.stringify(obj) + '\n';
  if (connected && socket) {
    socket.write(line);
  } else if (outbox.length < 5000) {
    outbox.push(line); // small backlog buffer in case the panel connects late
  }
}

/**
 * Walks an Error().stack string and returns the first frame that belongs to
 * user code -- i.e. not this agent file, not node_modules, not Node internals.
 */
function extractUserFrame(stack) {
  if (!stack) return null;
  const lines = stack.split('\n').slice(1); // drop the "Error" header line
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    if (line.includes('node_modules')) continue;
    if (line.includes('node:internal')) continue;
    if (line.includes(AGENT_FILE)) continue;
    const match = line.match(/at (?:(.*?)\s+\()?(.*):(\d+):(\d+)\)?$/);
    if (!match) continue;
    const [, fnNameRaw, file, lineNo] = match;
    return {
      label: fnNameRaw ? fnNameRaw.replace(/^Object\./, '').replace(/^new /, '') : '<anonymous>',
      file,
      line: Number(lineNo),
    };
  }
  return null;
}

const hook = async_hooks.createHook({
  init(asyncId, type, triggerAsyncId) {
    if (TRACKED_TYPES && !TRACKED_TYPES.has(type)) return;
    const info = extractUserFrame(new Error().stack);
    send({
      kind: 'async',
      asyncId,
      triggerAsyncId,
      resourceType: type,
      phase: 'init',
      label: info ? info.label : type,
      file: info ? info.file : undefined,
      line: info ? info.line : undefined,
      ts: performance.now(),
      processId: process.pid,
    });
  },
  before(asyncId) {
    send({ kind: 'async', asyncId, triggerAsyncId: 0, resourceType: '', phase: 'before', label: '', ts: performance.now(), processId: process.pid });
  },
  after(asyncId) {
    send({ kind: 'async', asyncId, triggerAsyncId: 0, resourceType: '', phase: 'after', label: '', ts: performance.now(), processId: process.pid });
  },
  destroy(asyncId) {
    send({ kind: 'async', asyncId, triggerAsyncId: 0, resourceType: '', phase: 'destroy', label: '', ts: performance.now(), processId: process.pid });
  },
});

hook.enable();

module.exports = {};
