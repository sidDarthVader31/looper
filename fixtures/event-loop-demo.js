/**
 * Minimal fixture for Looper demos.
 * Run via: Looper: Launch & Visualize → `node fixtures/event-loop-demo.js`
 */
'use strict';

function syncWork(label) {
  const start = Date.now();
  while (Date.now() - start < 30) {
    /* burn a little CPU so the sampler can see this frame */
  }
  console.log('sync:', label);
}

function scheduleMicrotasks() {
  Promise.resolve().then(function onMicroA() {
    syncWork('micro-A');
    return Promise.resolve().then(function onMicroB() {
      syncWork('micro-B');
    });
  });
  process.nextTick(function onNextTick() {
    syncWork('nextTick');
  });
}

function scheduleMacrotasks() {
  setTimeout(function onTimeout() {
    syncWork('timeout');
    scheduleMicrotasks();
  }, 50);

  setImmediate(function onImmediate() {
    syncWork('immediate');
  });
}

console.log('demo start');
syncWork('main');
scheduleMacrotasks();
scheduleMicrotasks();

// Keep process alive briefly so the visualizer can sample
setTimeout(function done() {
  console.log('demo done');
}, 500);
