import { VizEvent } from './shared/types';

const MAX_EVENTS = 20000;

export class EventStore {
  private events: VizEvent[] = [];

  append(event: VizEvent): void {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
  }

  getAll(): VizEvent[] {
    return this.events;
  }

  getRange(fromTs: number, toTs: number): VizEvent[] {
    return this.events.filter((e) => e.ts >= fromTs && e.ts <= toTs);
  }

  clear(): void {
    this.events = [];
  }
}
