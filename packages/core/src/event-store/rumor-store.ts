import { Rumor, verifyRumor } from "../helpers/event.js";
import { EventStore, EventStoreOptions } from "./event-store.js";

/**
 * An {@link EventStore} for unsigned NIP-59 rumors that verifies each rumor by recomputing its
 * event hash instead of checking a signature. `verifyEvent` is locked to {@link verifyRumor} and
 * cannot be overridden by callers.
 */
export class RumorStore extends EventStore<Rumor> {
  constructor(options?: Omit<EventStoreOptions<Rumor>, "verifyEvent">) {
    super({ ...options, verifyEvent: verifyRumor });
  }
}
