'use strict';

const net = require('net');
const path = require('path');
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
/** asyncId -> { resourceType, label, file, line } */
const tracked = new Map();

function connect() {
  socket = net.connect({ host: '127.0.0.1', port: PORT }, () => {
    connected = true;
    while (outbox.length) socket.write(outbox.shift());
  });
  socket.on('error', () => {
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
    outbox.push(line);
  }
}

function cleanLabel(raw) {
  if (!raw) return '<anonymous>';
  return (
    raw
      .replace(/^async\s+/, '')
      .replace(/^Object\./, '')
      .replace(/^new\s+/, '')
      .replace(/^Function\./, '')
      .trim() || '<anonymous>'
  );
}

function isAnonymousName(name) {
  return !name || name === '<anonymous>' || name === 'anonymous' || name === '(anonymous)';
}

/**
 * Walks Error().stack and picks the best *user* frame.
 * Prefers a named function further up the stack over a nearer anonymous frame.
 */
function extractBestUserFrame(stack) {
  if (!stack) return null;
  const frames = [];
  const lines = stack.split('\n').slice(1);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('at ')) continue;
    if (line.includes('node_modules')) continue;
    if (line.includes('node:')) continue;
    if (line.includes(AGENT_FILE)) continue;
    if (line.includes('instrument.js')) continue;
    const match = line.match(/at (?:(.*?)\s+\()?(.*):(\d+):(\d+)\)?$/);
    if (!match) continue;
    const [, fnNameRaw, file, lineNo] = match;
    const label = cleanLabel(fnNameRaw);
    frames.push({
      label,
      file,
      line: Number(lineNo),
    });
  }
  if (!frames.length) return null;

  const named = frames.find((f) => !isAnonymousName(f.label));
  const best = named || frames[0];
  if (isAnonymousName(best.label)) {
    const base = path.basename(best.file || '') || '?';
    best.label = `anon (${base}:${best.line})`;
  }
  return best;
}

const hook = async_hooks.createHook({
  init(asyncId, type, triggerAsyncId) {
    if (TRACKED_TYPES && !TRACKED_TYPES.has(type)) return;
    const info = extractBestUserFrame(new Error().stack);
    if (!info && !VERBOSE) return;
    const meta = {
      resourceType: type,
      label: info ? info.label : type,
      file: info ? info.file : undefined,
      line: info ? info.line : undefined,
    };
    tracked.set(asyncId, meta);
    send({
      kind: 'async',
      asyncId,
      triggerAsyncId,
      resourceType: meta.resourceType,
      phase: 'init',
      label: meta.label,
      file: meta.file,
      line: meta.line,
      ts: performance.now(),
      processId: process.pid,
    });
  },
  before(asyncId) {
    const meta = tracked.get(asyncId);
    if (!meta) return;
    const info = extractBestUserFrame(new Error().stack);
    const betterLabel =
      info && !String(info.label).startsWith('anon (') ? info.label : meta.label;
    send({
      kind: 'async',
      asyncId,
      triggerAsyncId: 0,
      resourceType: meta.resourceType,
      phase: 'before',
      label: betterLabel,
      file: (info && info.file) || meta.file,
      line: (info && info.line) || meta.line,
      ts: performance.now(),
      processId: process.pid,
    });
  },
  after(asyncId) {
    const meta = tracked.get(asyncId);
    if (!meta) return;
    send({
      kind: 'async',
      asyncId,
      triggerAsyncId: 0,
      resourceType: meta.resourceType,
      phase: 'after',
      label: meta.label,
      file: meta.file,
      line: meta.line,
      ts: performance.now(),
      processId: process.pid,
    });
  },
  /**
   * Promises often never get before/after/destroy until GC. Without this,
   * every PROMISE chip would stick in the microtask lane forever.
   */
  promiseResolve(asyncId) {
    const meta = tracked.get(asyncId);
    if (!meta) return;
    send({
      kind: 'async',
      asyncId,
      triggerAsyncId: 0,
      resourceType: meta.resourceType,
      phase: 'promiseResolve',
      label: meta.label,
      file: meta.file,
      line: meta.line,
      ts: performance.now(),
      processId: process.pid,
    });
  },
  destroy(asyncId) {
    const meta = tracked.get(asyncId);
    if (!meta) return;
    tracked.delete(asyncId);
    send({
      kind: 'async',
      asyncId,
      triggerAsyncId: 0,
      resourceType: meta.resourceType,
      phase: 'destroy',
      label: meta.label,
      file: meta.file,
      line: meta.line,
      ts: performance.now(),
      processId: process.pid,
    });
  },
});

hook.enable();

module.exports = {};
