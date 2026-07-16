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
}

export interface StackSampleEvent {
  kind: 'stack';
  frames: StackFrame[];
  ts: number;
  processId: number;
}

export type VizEvent = AsyncLifecycleEvent | StackSampleEvent;

export type WebviewToExtensionMessage =
  | { command: 'play' }
  | { command: 'pause' }
  | { command: 'seek'; ts: number }
  | { command: 'liveMode' };

export type ExtensionToWebviewMessage =
  | { command: 'event'; event: VizEvent }
  | { command: 'reset' }
  | { command: 'replayRange'; from: number; to: number };
