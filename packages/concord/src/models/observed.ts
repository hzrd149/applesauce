import type { Model } from "applesauce-core/event-store";
import type { Rumor } from "applesauce-core/helpers/event";
import { map } from "rxjs";

import { observedAuthors } from "./utils.js";

/** Compute latest observed activity per author from a RumorStore. */
export function ConcordObservedAuthorsModel(): Model<Map<string, number>, Rumor> {
  return (store) => store.timeline([{}]).pipe(map(observedAuthors));
}
