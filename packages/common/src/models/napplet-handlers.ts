import { IEventSubscriptions, Model } from "applesauce-core/event-store";
import { combineLatest, map, Observable, of, switchMap } from "rxjs";
import {
  getNappletHandlerRefKey,
  getNappletHandlersFilter,
  getPublicNappletHandlers,
  isValidNappletHandlers,
  NappletHandlerRef,
  NappletHandlersEvent,
} from "../helpers/napplet-handlers.js";
import { isValidNapplet, isValidNappletSnapshot, NappletEvent, nappletSupportsConvention } from "../helpers/napplet.js";

/** A napplet recommended as a handler, with the authors recommending it */
export interface RecommendedNappletHandler {
  /** The napplet manifest or pinned snapshot */
  napplet: NappletEvent;
  /** The reference the recommenders used */
  ref: NappletHandlerRef;
  /** The pubkeys of the authors recommending the napplet */
  recommenders: string[];
}

/** Subscribes to the manifest a handler reference points to, if it is a valid napplet */
function subscribeHandlerNapplet(
  store: IEventSubscriptions,
  ref: NappletHandlerRef,
): Observable<NappletEvent | undefined> {
  // A pin must resolve to a snapshot, never to the napplet it derives from
  if (ref.type === "snapshot") {
    return store.event(ref.pointer).pipe(map((event) => (isValidNappletSnapshot(event) ? event : undefined)));
  }

  return store.replaceable(ref.pointer).pipe(map((event) => (isValidNapplet(event) ? event : undefined)));
}

/** A model that returns handler preferences for an archetype, optionally from a set of authors */
export function NappletHandlersModel(archetype: string, authors?: string[]): Model<NappletHandlersEvent[]> {
  return (store) =>
    store
      .timeline(getNappletHandlersFilter(archetype, authors))
      .pipe(map((events) => events.filter(isValidNappletHandlers)));
}

/** A model that returns the napplets others publicly recommend for an archetype or intent, ranked by recommender count */
export function RecommendedNappletHandlersModel(
  archetype: string,
  authors?: string[],
  identity?: string,
): Model<RecommendedNappletHandler[]> {
  return (store) =>
    store.model(NappletHandlersModel, archetype, authors).pipe(
      switchMap((events) => {
        const ranked = new Map<string, { ref: NappletHandlerRef; recommenders: Set<string> }>();

        for (const event of events) {
          // Only public entries are recommendations, and they can only suggest a handler
          const entries = getPublicNappletHandlers(event);
          const refs = identity ? [...(entries.intents.get(identity) ?? []), ...entries.handlers] : entries.handlers;

          for (const ref of refs) {
            const key = getNappletHandlerRefKey(ref);
            const entry = ranked.get(key) ?? { ref, recommenders: new Set<string>() };

            entry.recommenders.add(event.pubkey);
            ranked.set(key, entry);
          }
        }
        if (ranked.size === 0) return of([]);

        const sorted = [...ranked.values()].sort((a, b) => b.recommenders.size - a.recommenders.size);

        return combineLatest(sorted.map((entry) => subscribeHandlerNapplet(store, entry.ref))).pipe(
          map((napplets) =>
            napplets.flatMap((napplet, i): RecommendedNappletHandler[] => {
              if (!napplet) return [];

              // Skip napplets whose manifest does not advertise the requested convention
              if (identity && !nappletSupportsConvention(napplet, identity)) return [];

              return [{ napplet, ref: sorted[i].ref, recommenders: [...sorted[i].recommenders] }];
            }),
          ),
        );
      }),
    );
}
