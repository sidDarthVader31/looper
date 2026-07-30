export type AsyncResourceType = 'PROMISE' | 'Timeout' | 'Immediate' | 'TickObject' | string;

export type LifecyclePhase = 'init' | 'before' | 'after' | 'destroy' | 'promiseResolve';

export interface AsyncLifecycleEvent {
  kind: 'async';
  asyncId: number;
  triggerAsyncId: number;
  resourceType: AsyncResourceType;
  phase: LifecyclePhase;
  label: string;
  file?: string;
  line?: number;
  ts: number;
  processId: number;
}

export interface StackFrame {
  functionName: string;
  url: string;
  line: number;
  column: number;
  /** True when frame was synthesized from an async before/after (not CDP). */
  synthetic?: boolean;
  asyncId?: number;
}

export interface StackSampleEvent {
  kind: 'stack';
  frames: StackFrame[];
  ts: number;
  processId: number;
}

export type VizEvent = AsyncLifecycleEvent | StackSampleEvent;

export type PlaybackMode = 'live' | 'paused' | 'playing';

export type WebviewToExtensionMessage =
  | { command: 'ready' }
  | { command: 'liveMode' }
  | { command: 'stop' }
  | { command: 'clear' };

export type ExtensionToWebviewMessage =
  | { command: 'event'; event: VizEvent }
  | { command: 'reset' }
  | { command: 'sessionStart' }
  | { command: 'sessionStopped' }
  | { command: 'cleared' };
