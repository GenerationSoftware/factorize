export type EventKind = "manual" | "schedule" | "webhook";

/** A Trigger's input source configuration. */
export interface Event {
  id: string;
  triggerId: string;
  kind: EventKind;
  slug: string;
  enabled: boolean;
  config: Record<string, unknown>;
  template?: string;
  createdAt: string;
  updatedAt: string;
}

/** A Trigger watches input sources and publishes to its parent Event. */
export interface Trigger {
  id: string;
  eventId: string;
  name: string;
  description: string;
  slug: string;
  revision: number;
  enabled: boolean;
  events: Event[];
  createdAt: string;
  updatedAt: string;
}

export interface TriggerRepository {
  getTrigger(id: string): Promise<Trigger | null>;
  list(): Promise<Trigger[]>;
  create(trigger: Trigger): Promise<Trigger>;
  update(trigger: Trigger, expectedUpdatedAt?: string): Promise<Trigger>;
  setEnabled(id: string, enabled: boolean, changedAt: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
}

export class StaleTriggerEdit extends Error {}
