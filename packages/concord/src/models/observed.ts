import type { Model } from "applesauce-core/event-store";
import { isEphemeralKind, type Rumor } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { observedAuthors } from "./utils.js";

/**
 * Compute latest observed activity per author from a RumorStore.
 *
 * Observation means *durable* authorship: ephemeral kinds (NIP-01 range
 * 20000-29999) never count as presence in the roster fold, so a voice
 * beacon cannot resurrect a removed member. This is a range check by
 * design — enumerating a single kind (e.g. the voice-presence beacon) is
 * the anti-pattern being avoided, since any future presence-like kind must
 * be covered by construction.
 */
export function ConcordObservedAuthorsModel(): Model<Map<string, number>, Rumor> {
  return (store) =>
    store.timeline([{}]).pipe(map((rumors) => observedAuthors(rumors.filter((r) => !isEphemeralKind(r.kind)))));
}
