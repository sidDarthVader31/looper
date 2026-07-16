# Looper

A VS Code extension that visualizes the Node.js call stack, microtask queue,
and macrotask queue **live**, using your real function names — without
modifying, wrapping, or adding any dependency to your codebase.

## How it works

Two independent data sources feed the visualization:

- **Call stack** (what's executing right now) comes from the V8 inspector's
  `Profiler` domain over the Chrome DevTools Protocol (CDP) — a native
  sampling profiler, the same mechanism `0x` and Chrome DevTools use for
  flame graphs.
- **Microtask / macrotask queues** (what's pending) come from Node's built-in
  `async_hooks` module. On every `init` event we capture the creation-time
  stack trace and walk it to find the nearest *user-code* frame — this is
  how you see `checkRedis` in the queue instead of a random `PROMISE #47`.

Both are injected into your process without touching your source files:

- **Launch mode**: the extension spawns your app with
  `NODE_OPTIONS="--require <agent> --inspect=<port>"`. The `--require` script
  lives inside the extension's own install directory — nothing is added to
  your `node_modules` or `package.json`.
- **Attach mode**: for an already-running process started with `--inspect`,
  the agent's source is injected via CDP's `Runtime.evaluate` — the same
  trick browser extensions use to inject a script into a live page. Only
  activity *after* the attach point will be visible, since anything already
  in flight was created before the hook existed.

Data flows: `agent (async_hooks + stack capture)` → plain TCP socket →
`extension host` → `webview` (call stack / microtask / macrotask columns +
a scrubbable timeline for replay).

## Project layout

See the file tree at the top of this document / your repo root.

## Setup

```bash
npm install
npm run compile
```

Then press `F5` in VS Code (uses `.vscode/launch.json`) to open an
Extension Development Host with the extension loaded.

## Usage

- `Cmd/Ctrl+Shift+P` → **Event Loop Visualizer: Launch & Visualize** →
  enter the command that starts your app (e.g. `node dist/server.js`).
- Or **Event Loop Visualizer: Attach to Running Process** → enter the
  inspector port (default `9229`) of an app already running with
  `--inspect`.

A panel opens beside your editor showing three live columns (call stack,
microtask queue, macrotask queue) plus a timeline at the bottom you can
scrub to replay past activity.

## Known limitations (by design, v0.1)

- **Anonymous inline callbacks** (`app.post('/x', async (req,res) => {...})`
  with no variable/property name) show as `<anonymous>` — V8 can't infer a
  name it was never given. Named handlers work fine.
- **libuv's internal phases** (timers / pending callbacks / poll / check /
  close) are not exposed by any public Node API. This tool visualizes the
  call stack + micro/macrotask queue mental model, not literal libuv phase
  transitions.
- **TypeScript/bundled source maps** aren't wired in yet — the CDP profiler
  reports positions in the compiled JS. The inspector protocol supports
  source maps natively; this is the next planned improvement.
- **Worker threads / cluster / child_process** each run their own event
  loop and would need their own agent connection — not yet multiplexed in
  the UI.
- **`async_hooks` overhead**: expect a measurable slowdown on very
  async-heavy workloads while visualization is active. Treat this as a
  debug-time tool, not something left on in production.

## Roadmap

1. Source-map support for TypeScript/bundled apps.
2. Worker thread / cluster process picker in the panel.
3. Persist replay sessions to disk for later loading.
4. Blackbox/allowlist configuration for which `node_modules` frames to hide.
