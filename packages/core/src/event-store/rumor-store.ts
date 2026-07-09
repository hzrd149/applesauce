import { Rumor, verifyRumor } from "../helpers/event.js";
import { EventStore, EventStoreOptions } from "./event-store.js";

/**
 * An {@link EventStore} for unsigned NIP-59 rumors. On `add`, non-deletion rumors are verified by
 * recomputing the event hash and checking it equals `rumor.id` (via {@link verifyRumor}) instead of
 * checking a signature. `verifyEvent` defaults to {@link verifyRumor} and cannot be supplied through
 * the constructor options (it is `Omit`-ted), though it remains reassignable via the inherited
 * `verifyEvent` setter at runtime.
 *
 * Like the base signed store, kind-5 delete rumors are applied without per-event verification —
 * the rumor store is intended to hold events from an upstream protocol layer that already verifies
 * validity and authorization; the local verifier only guarantees a stored rumor's `id` matches its
 * serialized contents.
 */
export class RumorStore extends EventStore<Rumor> {
  constructor(options?: Omit<EventStoreOptions<Rumor>, "verifyEvent">) {
    super({ ...options, verifyEvent: verifyRumor });
  }
}
