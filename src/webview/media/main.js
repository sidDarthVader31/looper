(function () {
  const vscode = acquireVsCodeApi();

  const MACRO_TYPES = new Set(['Timeout', 'Immediate']);
  const MICRO_TYPES = new Set(['PROMISE', 'TickObject']);
  const TYPE_BADGE = {
    PROMISE: 'Promise',
    Timeout: 'Timeout',
    Immediate: 'Immediate',
    TickObject: 'nextTick',
  };

  const MAX_FLIES = 2;
  const FLY_MS = 320;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    empty: document.getElementById('empty'),
    viz: document.getElementById('viz'),
    callstackList: document.getElementById('callstack-list'),
    microtaskList: document.getElementById('microtask-list'),
    macrotaskList: document.getElementById('macrotask-list'),
    callstackCount: document.getElementById('callstack-count'),
    microtaskCount: document.getElementById('microtask-count'),
    macrotaskCount: document.getElementById('macrotask-count'),
    callstackEmpty: document.getElementById('callstack-empty'),
    microtaskEmpty: document.getElementById('microtask-empty'),
    macrotaskEmpty: document.getElementById('macrotask-empty'),
    callstackCol: document.getElementById('callstack-col'),
    microtaskCol: document.getElementById('microtask-col'),
    macrotaskCol: document.getElementById('macrotask-col'),
    scrub: document.getElementById('scrub'),
    timeline: document.getElementById('timeline'),
    timeReadout: document.getElementById('time-readout'),
    btnLive: document.getElementById('btn-live'),
    btnStop: document.getElementById('btn-stop'),
    btnClear: document.getElementById('btn-clear'),
    btnPlay: document.getElementById('btn-play'),
    btnStepBack: document.getElementById('btn-step-back'),
    btnStepFwd: document.getElementById('btn-step-fwd'),
    playIcon: document.getElementById('play-icon'),
    playLabel: document.getElementById('play-label'),
    speed: document.getElementById('speed'),
  };
  const ctx = els.timeline.getContext('2d');

  /** @type {'live' | 'paused' | 'playing'} */
  let mode = 'live';
  /** @type {any[]} */
  let allEvents = [];
  let cursor = -1;
  let playTimer = null;
  let speed = 0.25;
  let sessionActive = false;
  let recording = false;
  let scrubbing = false;
  let timelineRaf = 0;
  let allowMotion = true;
  let activeFlies = 0;
  /** @type {number[]} */
  const pendingTimers = [];

  let queueItems = new Map();
  let cdpStack = [];
  let executing = new Map();
  let stackFrames = [];

  const queueDom = new Map();
  const stackDom = new Map();

  window.addEventListener('message', (e) => {
    const msg = e.data;
    if (msg.command === 'event') {
      onLiveEvent(msg.event);
    } else if (msg.command === 'reset') {
      hardReset({ keepSession: false });
    } else if (msg.command === 'sessionStart') {
      hardReset({ keepSession: false });
      sessionActive = true;
      recording = true;
      showViz(true);
      setMode('live');
      updateControls();
    } else if (msg.command === 'sessionStopped') {
      recording = false;
      if (mode === 'live') setMode('paused');
      updateControls();
    }
    // 'cleared' from host is informational only — UI already cleared on button click
    // so we don't wipe events that arrived in the round-trip gap.
  });

  vscode.postMessage({ command: 'ready' });

  function trackTimeout(fn, ms) {
    const id = setTimeout(() => {
      const i = pendingTimers.indexOf(id);
      if (i >= 0) pendingTimers.splice(i, 1);
      fn();
    }, ms);
    pendingTimers.push(id);
    return id;
  }

  function cancelPendingTimers() {
    for (const id of pendingTimers) clearTimeout(id);
    pendingTimers.length = 0;
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    document.querySelectorAll('.fly-chip').forEach((n) => n.remove());
    activeFlies = 0;
  }

  function setMode(next) {
    if (playTimer) {
      clearTimeout(playTimer);
      playTimer = null;
    }
    mode = next;
    els.btnLive.classList.toggle('is-selected', mode === 'live');
    els.btnLive.setAttribute('aria-pressed', mode === 'live' ? 'true' : 'false');
    const playing = mode === 'playing';
    els.btnPlay.classList.toggle('is-playing', playing);
    els.btnPlay.setAttribute('aria-pressed', playing ? 'true' : 'false');
    els.playIcon.textContent = playing ? '❚❚' : '▶';
    els.playLabel.textContent = playing ? 'Pause' : 'Play';
    if (playing) scheduleNextPlayTick();
  }

  function updateControls() {
    const hasEvents = allEvents.length > 0;
    els.scrub.disabled = !hasEvents;
    els.btnStepBack.disabled = !hasEvents || cursor <= 0;
    els.btnStepFwd.disabled = !hasEvents || cursor >= allEvents.length - 1;
    els.btnPlay.disabled = !hasEvents || (mode === 'live' && recording);
    els.btnLive.disabled = !sessionActive || !recording;
    els.btnStop.disabled = !recording;
    els.btnClear.disabled = !sessionActive || !hasEvents;
  }

  function showViz(on) {
    els.empty.classList.toggle('hidden', on);
    els.viz.classList.toggle('hidden', !on);
    els.viz.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  function hardReset(opts) {
    cancelPendingTimers();
    allEvents = [];
    cursor = -1;
    queueItems = new Map();
    cdpStack = [];
    executing = new Map();
    stackFrames = [];
    queueDom.clear();
    stackDom.clear();
    els.callstackList.innerHTML = '';
    els.microtaskList.innerHTML = '';
    els.macrotaskList.innerHTML = '';
    clearLaneActive();
    clearTimeline();
    updateEmptyHints();
    updateCounts();
    updateTimeReadout();
    if (!opts || !opts.keepSession) {
      sessionActive = false;
      recording = false;
      showViz(false);
      setMode('live');
    }
    updateControls();
  }

  function clearHistory() {
    // Wipe timeline + live lanes only. Never touch recording / session / process.
    const keepRecording = recording;
    const keepSession = sessionActive;
    cancelPendingTimers();
    allEvents = [];
    cursor = -1;
    queueItems = new Map();
    cdpStack = [];
    executing = new Map();
    stackFrames = [];
    queueDom.clear();
    stackDom.clear();
    els.callstackList.innerHTML = '';
    els.microtaskList.innerHTML = '';
    els.macrotaskList.innerHTML = '';
    clearLaneActive();
    clearTimeline();
    updateEmptyHints();
    updateCounts();
    updateTimeReadout();
    sessionActive = keepSession;
    recording = keepRecording;
    if (keepSession) {
      showViz(true);
      if (keepRecording) setMode('live');
      else if (mode === 'playing') setMode('paused');
    }
    updateControls();
  }

  function removeQueueItem(asyncId, animate) {
    if (!queueItems.has(asyncId) && !queueDom.has(asyncId)) return;
    queueItems.delete(asyncId);
    if (animate && queueDom.has(asyncId) && !reducedMotion) {
      exitChip(asyncId, () => {
        renderQueues(false);
      });
    } else {
      const li = queueDom.get(asyncId);
      if (li) {
        queueDom.delete(asyncId);
        li.remove();
      }
      renderQueues(false);
    }
  }

  function removeExecuting(asyncId, animate) {
    if (!executing.has(asyncId)) return;
    const key = 'synth:' + asyncId;
    const li = stackDom.get(key);
    executing.delete(asyncId);
    mergeStack();
    if (animate && li && !reducedMotion) {
      li.classList.add('is-complete');
      trackTimeout(() => {
        renderCallStack(false);
      }, 200);
    } else {
      renderCallStack(animate);
    }
  }

  function mergeStack() {
    stackFrames = [...cdpStack, ...[...executing.values()]];
  }

  function typeBadge(resourceType) {
    return TYPE_BADGE[resourceType] || resourceType || '';
  }

  function shortUrl(url) {
    if (!url) return '';
    const parts = url.replace(/^file:\/\//, '').split('/');
    return parts.slice(-2).join('/');
  }

  function queueListFor(resourceType) {
    if (MICRO_TYPES.has(resourceType)) return els.microtaskList;
    if (MACRO_TYPES.has(resourceType)) return els.macrotaskList;
    return null;
  }

  function laneFor(resourceType) {
    if (MICRO_TYPES.has(resourceType)) return els.microtaskCol;
    if (MACRO_TYPES.has(resourceType)) return els.macrotaskCol;
    return null;
  }

  function flashLane(el, ms) {
    if (!el) return;
    el.classList.add('is-active');
    trackTimeout(() => el.classList.remove('is-active'), ms || 450);
  }

  function clearLaneActive() {
    els.callstackCol.classList.remove('is-active');
    els.microtaskCol.classList.remove('is-active');
    els.macrotaskCol.classList.remove('is-active');
  }

  function updateEmptyHints() {
    els.callstackEmpty.classList.toggle('is-hidden', stackFrames.length > 0);
    let micro = 0;
    let macro = 0;
    for (const item of queueItems.values()) {
      if (MICRO_TYPES.has(item.resourceType)) micro++;
      else if (MACRO_TYPES.has(item.resourceType)) macro++;
    }
    els.microtaskEmpty.classList.toggle('is-hidden', micro > 0);
    els.macrotaskEmpty.classList.toggle('is-hidden', macro > 0);
  }

  function destinationRect(listEl) {
    if (!listEl) return null;
    const last = listEl.lastElementChild;
    if (last) return last.getBoundingClientRect();
    const r = listEl.getBoundingClientRect();
    // Empty list: land near the top of the list area, not the column bottom.
    return {
      left: r.left + 4,
      top: r.top + 4,
      width: Math.max(80, r.width - 8),
      height: 28,
      right: r.right - 4,
      bottom: r.top + 32,
    };
  }

  function canFly() {
    return allowMotion && !reducedMotion && !scrubbing && activeFlies < MAX_FLIES;
  }

  function flyChip(fromRect, toRect, text, kindClass) {
    if (!fromRect || !toRect || !canFly()) return false;
    activeFlies++;
    const fly = document.createElement('div');
    fly.className = 'fly-chip' + (kindClass ? ' ' + kindClass : '');
    fly.textContent = text;
    fly.style.left = fromRect.left + 'px';
    fly.style.top = fromRect.top + 'px';
    fly.style.width = Math.min(fromRect.width || 160, 200) + 'px';
    document.body.appendChild(fly);
    requestAnimationFrame(() => {
      fly.style.transform =
        'translate(' + (toRect.left - fromRect.left) + 'px,' + (toRect.top - fromRect.top) + 'px) scale(0.96)';
      fly.style.opacity = '0.25';
    });
    trackTimeout(() => {
      fly.remove();
      activeFlies = Math.max(0, activeFlies - 1);
    }, FLY_MS);
    return true;
  }

  function onLiveEvent(event) {
    if (!recording) return;
    if (!sessionActive) {
      sessionActive = true;
      showViz(true);
    }
    allEvents.push(event);
    if (mode === 'live') {
      cursor = allEvents.length - 1;
      applyEvent(event, true);
      syncScrubFromCursor();
      scheduleTimelineDraw();
    } else {
      scheduleTimelineDraw();
    }
    updateControls();
    updateTimeReadout();
  }

  function applyEvent(event, animate) {
    if (event.kind === 'stack') {
      cdpStack = event.frames || [];
      mergeStack();
      renderCallStack(animate);
      return;
    }
    if (event.kind !== 'async') return;

    if (event.phase === 'init') {
      queueItems.set(event.asyncId, {
        label: event.label,
        resourceType: event.resourceType,
        phase: 'pending',
        file: event.file,
        line: event.line,
      });
      renderQueues(animate);
      flashLane(laneFor(event.resourceType), 400);
      if (animate) enqueueMotion(event);
      return;
    }

    if (event.phase === 'before') {
      // Ignore orphan before — never invent a fake PROMISE chip.
      const item = queueItems.get(event.asyncId);
      if (!item) return;

      if (event.label) item.label = event.label;
      if (event.file) item.file = event.file;
      if (event.line) item.line = event.line;

      const fromEl = queueDom.get(event.asyncId);
      const fromRect = fromEl ? fromEl.getBoundingClientRect() : null;

      queueItems.delete(event.asyncId);
      if (queueDom.has(event.asyncId)) {
        const li = queueDom.get(event.asyncId);
        queueDom.delete(event.asyncId);
        if (animate && !reducedMotion) {
          li.classList.add('is-exit');
          trackTimeout(() => li.remove(), 180);
        } else {
          li.remove();
        }
      }
      renderQueues(false);

      executing.set(event.asyncId, {
        functionName: item.label,
        url: item.file || '',
        line: item.line || 0,
        column: 0,
        synthetic: true,
        asyncId: event.asyncId,
        resourceType: item.resourceType,
      });
      mergeStack();
      renderCallStack(animate);
      flashLane(els.callstackCol, 500);

      if (animate && fromRect) {
        const to = destinationRect(els.callstackList);
        const kind = MACRO_TYPES.has(item.resourceType) ? 'fly-macro' : 'fly-stack';
        flyChip(fromRect, to, item.label, kind);
      }
      return;
    }

    if (event.phase === 'after' || event.phase === 'destroy' || event.phase === 'promiseResolve') {
      // Promise resolve: leave the microtask lane (Node often skips before/after
      // and delays destroy until GC — that was leaving every Promise stuck).
      removeExecuting(event.asyncId, animate && event.phase !== 'promiseResolve');
      removeQueueItem(event.asyncId, animate);
      return;
    }
  }

  function enqueueMotion(event) {
    const leaf =
      els.callstackList.querySelector('.chip-stack.is-leaf') || els.callstackList.lastElementChild;
    const list = queueListFor(event.resourceType);
    if (!list) return;
    const from = leaf ? leaf.getBoundingClientRect() : null;
    // Render first so destination chip exists, then fly toward it.
    const arrived = queueDom.get(event.asyncId);
    const to = arrived ? arrived.getBoundingClientRect() : destinationRect(list);
    if (leaf) {
      leaf.classList.add('is-schedule-flash');
      trackTimeout(() => leaf.classList.remove('is-schedule-flash'), 480);
    }
    if (from && to) {
      const kind = MACRO_TYPES.has(event.resourceType) ? 'fly-macro' : '';
      flyChip(from, to, event.label || event.resourceType, kind);
    }
    if (arrived) {
      arrived.classList.add('is-schedule-flash');
      trackTimeout(() => arrived.classList.remove('is-schedule-flash'), 500);
    }
  }

  function rebuildTo(toIndex) {
    allowMotion = false;
    cancelPendingTimers();
    queueItems = new Map();
    cdpStack = [];
    executing = new Map();
    stackFrames = [];
    queueDom.clear();
    stackDom.clear();
    els.callstackList.innerHTML = '';
    els.microtaskList.innerHTML = '';
    els.macrotaskList.innerHTML = '';
    clearLaneActive();

    cursor = toIndex;
    for (let i = 0; i <= toIndex; i++) {
      applyEvent(allEvents[i], false);
    }
    allowMotion = true;
    syncScrubFromCursor();
    drawTimeline();
    updateTimeReadout();
    updateControls();
  }

  function seekToIndex(idx, animateLast) {
    idx = Math.max(-1, Math.min(idx, allEvents.length - 1));
    if (idx === cursor) return;
    if (idx < cursor || idx === -1) {
      rebuildTo(idx);
      return;
    }
    for (let i = cursor + 1; i <= idx; i++) {
      applyEvent(allEvents[i], animateLast && i === idx);
    }
    cursor = idx;
    syncScrubFromCursor();
    drawTimeline();
    updateTimeReadout();
    updateControls();
  }

  const MIN_GAP_MS = 120;
  const MAX_GAP_MS = 2000;

  function scheduleNextPlayTick() {
    if (mode !== 'playing') return;
    if (cursor >= allEvents.length - 1) {
      setMode('paused');
      updateControls();
      return;
    }
    const nextIdx = cursor + 1;
    let delay = MIN_GAP_MS / speed;
    if (cursor >= 0) {
      const cur = allEvents[cursor];
      const next = allEvents[nextIdx];
      const realGap = Math.max(0, next.ts - cur.ts);
      delay = Math.min(MAX_GAP_MS, Math.max(MIN_GAP_MS, realGap) / speed);
    }
    playTimer = setTimeout(() => {
      seekToIndex(nextIdx, true);
      scheduleNextPlayTick();
    }, delay);
  }

  function stepBy(delta) {
    if (mode === 'live' || mode === 'playing') setMode('paused');
    seekToIndex(cursor + delta, true);
  }

  function frameKey(frame, i) {
    if (frame.synthetic && frame.asyncId != null) return 'synth:' + frame.asyncId;
    return frame.functionName + '|' + frame.url + '|' + frame.line + '|' + i;
  }

  function renderCallStack(animate) {
    const nextKeys = new Set();
    const fragKeys = [];
    stackFrames.slice(0, 16).forEach((frame, i) => {
      const key = frameKey(frame, i);
      nextKeys.add(key);
      fragKeys.push({ key, frame, i });
    });

    for (const [key, li] of [...stackDom.entries()]) {
      if (!nextKeys.has(key)) {
        stackDom.delete(key);
        if (animate && !reducedMotion) {
          li.classList.add('is-exit');
          trackTimeout(() => li.remove(), 180);
        } else {
          li.remove();
        }
      }
    }

    fragKeys.forEach(({ key, frame }, order) => {
      let li = stackDom.get(key);
      const isNew = !li;
      if (!li) {
        li = document.createElement('li');
        li.className = 'chip chip-stack';
        li.innerHTML =
          '<span class="chip-name"></span><span class="chip-meta"></span><span class="chip-badge"></span>';
        stackDom.set(key, li);
      }
      li.querySelector('.chip-name').textContent = frame.functionName || '(anonymous)';
      const loc = shortUrl(frame.url);
      li.querySelector('.chip-meta').textContent = frame.synthetic
        ? 'running' + (loc ? ' · ' + loc + (frame.line ? ':' + frame.line : '') : '')
        : loc
          ? loc + ':' + frame.line
          : '';
      const badge = li.querySelector('.chip-badge');
      if (frame.synthetic) {
        badge.textContent = typeBadge(frame.resourceType) || 'run';
        badge.hidden = false;
      } else {
        badge.textContent = 'frame';
        badge.hidden = order !== fragKeys.length - 1;
      }
      li.classList.toggle('is-leaf', order === fragKeys.length - 1);
      li.classList.toggle('is-synthetic', !!frame.synthetic);
      if (isNew && animate && !reducedMotion) {
        li.classList.remove('is-enter');
        void li.offsetWidth;
        li.classList.add('is-enter');
      }
      const current = els.callstackList.children[order];
      if (current !== li) {
        if (current) els.callstackList.insertBefore(li, current);
        else els.callstackList.appendChild(li);
      }
    });
    updateCounts();
    updateEmptyHints();
  }

  function renderQueues(animate) {
    const keep = new Set(queueItems.keys());

    for (const [id, li] of [...queueDom.entries()]) {
      if (!keep.has(id)) {
        queueDom.delete(id);
        if (animate && !reducedMotion) {
          li.classList.add('is-exit');
          trackTimeout(() => li.remove(), 180);
        } else {
          li.remove();
        }
      }
    }

    for (const [id, item] of queueItems) {
      const list = queueListFor(item.resourceType);
      if (!list) continue;

      let li = queueDom.get(id);
      const isNew = !li;
      if (!li) {
        li = document.createElement('li');
        li.className = 'chip';
        li.dataset.asyncId = String(id);
        li.innerHTML =
          '<span class="chip-name"></span><span class="chip-meta"></span><span class="chip-badge"></span>';
        queueDom.set(id, li);
      }

      const kindClass = MICRO_TYPES.has(item.resourceType) ? 'chip-micro' : 'chip-macro';
      li.classList.remove('chip-micro', 'chip-macro', 'state-pending', 'state-running');
      li.classList.add(kindClass, 'state-' + item.phase);
      li.querySelector('.chip-name').textContent = item.label || item.resourceType;
      const meta = item.file
        ? shortUrl(item.file) + (item.line ? ':' + item.line : '')
        : '';
      li.querySelector('.chip-meta').textContent = meta;
      li.querySelector('.chip-badge').textContent = typeBadge(item.resourceType);

      if (isNew) {
        list.appendChild(li);
        if (animate && !reducedMotion) {
          li.classList.remove('is-enter');
          void li.offsetWidth;
          li.classList.add('is-enter');
        }
      } else if (li.parentElement !== list) {
        list.appendChild(li);
      }
    }
    updateCounts();
    updateEmptyHints();
  }

  function exitChip(asyncId, done) {
    const li = queueDom.get(asyncId);
    if (!li) {
      done();
      return;
    }
    li.classList.add('is-exit');
    trackTimeout(() => {
      queueDom.delete(asyncId);
      li.remove();
      done();
    }, 180);
  }

  function updateCounts() {
    els.callstackCount.textContent = String(stackFrames.length);
    let micro = 0;
    let macro = 0;
    for (const item of queueItems.values()) {
      if (MICRO_TYPES.has(item.resourceType)) micro++;
      else if (MACRO_TYPES.has(item.resourceType)) macro++;
    }
    els.microtaskCount.textContent = String(micro);
    els.macrotaskCount.textContent = String(macro);
  }

  function clearTimeline() {
    const width = (els.timeline.width = els.timeline.clientWidth || 300);
    const height = els.timeline.height;
    ctx.clearRect(0, 0, width, height);
  }

  function timeBounds() {
    if (!allEvents.length) return { first: 0, last: 1 };
    return { first: allEvents[0].ts, last: allEvents[allEvents.length - 1].ts };
  }

  function scheduleTimelineDraw() {
    if (timelineRaf) return;
    timelineRaf = requestAnimationFrame(() => {
      timelineRaf = 0;
      drawTimeline();
    });
  }

  function drawTimeline() {
    const width = (els.timeline.width = els.timeline.clientWidth || 300);
    const height = els.timeline.height;
    ctx.clearRect(0, 0, width, height);
    if (!allEvents.length) return;

    const { first, last } = timeBounds();
    const span = Math.max(last - first, 1);
    const pad = 12;

    ctx.strokeStyle = 'rgba(127,127,127,0.22)';
    ctx.beginPath();
    ctx.moveTo(pad, 20);
    ctx.lineTo(width - pad, 20);
    ctx.moveTo(pad, 40);
    ctx.lineTo(width - pad, 40);
    ctx.moveTo(pad, 60);
    ctx.lineTo(width - pad, 60);
    ctx.stroke();

    ctx.font = '9px sans-serif';
    ctx.fillStyle = 'rgba(127,127,127,0.7)';
    ctx.fillText('stack', pad, 14);
    ctx.fillText('init', pad, 34);
    ctx.fillText('run', pad, 54);

    for (const event of allEvents) {
      const x = pad + ((event.ts - first) / span) * (width - pad * 2);
      if (event.kind === 'stack') {
        ctx.fillStyle = '#4fc1ff';
        ctx.fillRect(x, 16, 2, 8);
      } else if (event.phase === 'init') {
        ctx.fillStyle = MICRO_TYPES.has(event.resourceType) ? '#e2b93d' : '#c586c0';
        ctx.beginPath();
        ctx.arc(x, 40, 2.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (event.phase === 'before') {
        ctx.fillStyle = '#6a9955';
        ctx.beginPath();
        ctx.arc(x, 60, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (cursor >= 0 && cursor < allEvents.length) {
      const ts = allEvents[cursor].ts;
      const x = pad + ((ts - first) / span) * (width - pad * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(x - 4, 4, 8, height - 8);
      ctx.strokeStyle = '#cccccc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x, height - 4);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 4);
      ctx.lineTo(x - 5, 0);
      ctx.lineTo(x + 5, 0);
      ctx.closePath();
      ctx.fillStyle = '#cccccc';
      ctx.fill();
    }
  }

  function syncScrubFromCursor() {
    if (scrubbing) return;
    if (allEvents.length <= 1) {
      els.scrub.value = '1000';
      return;
    }
    els.scrub.value = String(Math.round((cursor / (allEvents.length - 1)) * 1000));
  }

  function updateTimeReadout() {
    if (!allEvents.length || cursor < 0) {
      els.timeReadout.textContent = '0.00s / 0.00s';
      return;
    }
    const { first, last } = timeBounds();
    const cur = allEvents[cursor].ts - first;
    const total = last - first;
    els.timeReadout.textContent =
      (cur / 1000).toFixed(2) + 's / ' + (total / 1000).toFixed(2) + 's';
  }

  els.btnStop.addEventListener('click', () => {
    if (!recording) return;
    vscode.postMessage({ command: 'stop' });
    recording = false;
    if (mode === 'live') setMode('paused');
    updateControls();
  });

  els.btnClear.addEventListener('click', () => {
    if (!sessionActive) return;
    // Optimistic local clear; host only clears EventStore — never stops the process.
    clearHistory();
    vscode.postMessage({ command: 'clear' });
  });

  els.btnLive.addEventListener('click', () => {
    if (!recording) return;
    setMode('live');
    if (allEvents.length) seekToIndex(allEvents.length - 1, false);
    vscode.postMessage({ command: 'liveMode' });
    updateControls();
  });

  els.btnPlay.addEventListener('click', () => {
    if (mode === 'playing') {
      setMode('paused');
    } else {
      if (cursor >= allEvents.length - 1) seekToIndex(-1, false);
      setMode('playing');
    }
    updateControls();
  });

  els.btnStepBack.addEventListener('click', () => stepBy(-1));
  els.btnStepFwd.addEventListener('click', () => stepBy(1));

  els.speed.addEventListener('change', () => {
    const v = Number(els.speed.value);
    speed = v > 0 && v <= 1 ? v : 0.25;
  });

  els.scrub.addEventListener('pointerdown', () => {
    scrubbing = true;
    if (mode === 'live' || mode === 'playing') setMode('paused');
  });
  els.scrub.addEventListener('pointerup', () => {
    scrubbing = false;
  });
  els.scrub.addEventListener('input', () => {
    if (!allEvents.length) return;
    if (mode === 'live' || mode === 'playing') setMode('paused');
    const idx = Math.floor((Number(els.scrub.value) / 1000) * (allEvents.length - 1));
    rebuildTo(idx);
  });

  els.timeline.addEventListener('click', (ev) => {
    if (!allEvents.length) return;
    const rect = els.timeline.getBoundingClientRect();
    const pad = 12;
    const x = ev.clientX - rect.left;
    const t = Math.max(0, Math.min(1, (x - pad) / (rect.width - pad * 2)));
    const { first, last } = timeBounds();
    const ts = first + t * (last - first);
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < allEvents.length; i++) {
      const d = Math.abs(allEvents[i].ts - ts);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    if (mode === 'live' || mode === 'playing') setMode('paused');
    rebuildTo(best);
  });

  window.addEventListener('resize', () => drawTimeline());

  window.addEventListener('keydown', (ev) => {
    if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'SELECT')) return;
    if (ev.code === 'Space') {
      ev.preventDefault();
      if (!els.btnPlay.disabled) els.btnPlay.click();
    } else if (ev.code === 'ArrowLeft') {
      ev.preventDefault();
      stepBy(-1);
    } else if (ev.code === 'ArrowRight') {
      ev.preventDefault();
      stepBy(1);
    }
  });
})();
