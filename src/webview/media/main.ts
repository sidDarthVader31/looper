(function () {
  const vscode = acquireVsCodeApi();

  const callstackList = document.getElementById('callstack-list');
  const microtaskList = document.getElementById('microtask-list');
  const macrotaskList = document.getElementById('macrotask-list');
  const scrub = document.getElementById('scrub');
  const timelineCanvas = document.getElementById('timeline');
  const ctx = timelineCanvas.getContext('2d');

  const MACRO_TYPES = new Set(['Timeout', 'Immediate', 'TCPWRAP']);
  const MICRO_TYPES = new Set(['PROMISE', 'TickObject']);

  /** asyncId -> { label, resourceType, phase } */
  const queueItems = new Map();
  const allEvents = [];
  let firstTs = null;

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.command === 'event') {
      handleEvent(msg.event);
    } else if (msg.command === 'reset') {
      queueItems.clear();
      renderQueues();
    }
  });

  function handleEvent(event) {
    allEvents.push(event);
    if (firstTs === null) firstTs = event.ts;
    drawTimelineDot(event);

    if (event.kind === 'stack') {
      renderCallStack(event.frames);
      return;
    }

    if (event.kind === 'async') {
      if (event.phase === 'init') {
        queueItems.set(event.asyncId, {
          label: event.label,
          resourceType: event.resourceType,
          phase: 'pending',
        });
      } else if (event.phase === 'before') {
        const item = queueItems.get(event.asyncId);
        if (item) item.phase = 'running';
      } else if (event.phase === 'after' || event.phase === 'destroy') {
        queueItems.delete(event.asyncId);
      }
      renderQueues();
    }
  }

  function renderCallStack(frames) {
    callstackList.innerHTML = '';
    for (const frame of frames.slice(0, 12)) {
      const li = document.createElement('li');
      li.textContent = `${frame.functionName}  (${shortUrl(frame.url)}:${frame.line})`;
      callstackList.appendChild(li);
    }
  }

  function renderQueues() {
    microtaskList.innerHTML = '';
    macrotaskList.innerHTML = '';
    for (const [, item] of queueItems) {
      const li = document.createElement('li');
      li.textContent = item.label;
      li.className = `state-${item.phase}`;
      if (MICRO_TYPES.has(item.resourceType)) {
        microtaskList.appendChild(li);
      } else if (MACRO_TYPES.has(item.resourceType)) {
        macrotaskList.appendChild(li);
      }
    }
  }

  function shortUrl(url) {
    if (!url) return '?';
    const parts = url.split('/');
    return parts.slice(-2).join('/');
  }

  function drawTimelineDot(event) {
    const width = (timelineCanvas.width = timelineCanvas.clientWidth);
    const height = timelineCanvas.height;
    const elapsed = event.ts - firstTs;
    const x = 10 + (elapsed / 30000) * (width - 20); // ~30s rolling window
    const y = event.kind === 'stack' ? 15 : event.phase === 'init' ? 40 : 60;
    ctx.fillStyle = event.kind === 'stack' ? '#569cd6' : event.phase === 'init' ? '#d7ba7d' : '#6a9955';
    ctx.beginPath();
    ctx.arc(Math.min(x, width - 5), y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  document.getElementById('btn-live').addEventListener('click', () => {
    vscode.postMessage({ command: 'liveMode' });
  });
  document.getElementById('btn-play').addEventListener('click', () => {
    vscode.postMessage({ command: 'play' });
  });
  document.getElementById('btn-pause').addEventListener('click', () => {
    vscode.postMessage({ command: 'pause' });
  });
  scrub.addEventListener('input', () => {
    if (!allEvents.length) return;
    const idx = Math.floor((scrub.value / 1000) * (allEvents.length - 1));
    const ts = allEvents[idx].ts;
    vscode.postMessage({ command: 'seek', ts });
  });
})();
