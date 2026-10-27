import hash_sum from "hash-sum";
import { Observable, Subscription, timer } from "rxjs";

import { Model } from "../event-store/interface.js";
import { getEventUID, NostrEvent, StoreEvent } from "../helpers/event.js";
import { compileFilters, Filter } from "../helpers/filter.js";

/** Options for a timeline's version retention and snapshot scheduling */
export interface TimelineOptions {
  /** Whether to include each replaceable version retained by the store; defaults to false */
  includeOldVersion?: boolean;
  /** The snapshot window in milliseconds, or false for immediate updates; defaults to 16 */
  batchWindow?: number | false;
}

type TimelineMember<E> = { event: E; sequence: number; published: boolean };
type TimelineUpdate<E> = { insert: E } | { remove: { uid: string; id: string } };

function normalizeTimelineOptions(options: boolean | TimelineOptions) {
  return {
    includeOldVersion: typeof options === "boolean" ? options : (options.includeOldVersion ?? false),
    batchWindow: typeof options === "boolean" ? 16 : (options.batchWindow ?? 16),
  };
}

function isNewerVersion(event: StoreEvent, previous: StoreEvent) {
  return (
    event.id !== previous.id &&
    (event.created_at > previous.created_at || (event.created_at === previous.created_at && event.id < previous.id))
  );
}

/**
 * Creates a timeline using the legacy version-retention argument
 * @deprecated Use TimelineModel(filters, { includeOldVersion }) instead; the boolean argument will be removed in the next major release
 */
export function TimelineModel<E extends StoreEvent = NostrEvent>(
  filters: Filter | Filter[],
  includeOldVersion: boolean,
): Model<E[], E>;
// Keep the broad overload last so cached model constructors can infer both supported argument forms
/**
 * Creates a sorted timeline with an immediate initial snapshot and batched live updates
 * @throws If batchWindow is outside the supported timer range
 */
export function TimelineModel<E extends StoreEvent = NostrEvent>(
  filters: Filter | Filter[],
  options?: boolean | TimelineOptions,
): Model<E[], E>;
export function TimelineModel<E extends StoreEvent = NostrEvent>(
  filters: Filter | Filter[],
  options: boolean | TimelineOptions = {},
): Model<E[], E> {
  const { includeOldVersion, batchWindow } = normalizeTimelineOptions(options);

  if (batchWindow !== false && (!Number.isFinite(batchWindow) || batchWindow < 0 || batchWindow > 2_147_483_647)) {
    throw new Error("batchWindow must be false or a number between 0 and 2147483647");
  }

  const matches = compileFilters<E>(Array.isArray(filters) ? filters : [filters]);
  const getUID = (event: E) => (includeOldVersion ? event.id : getEventUID(event));
  const compareMembers = (a: TimelineMember<E>, b: TimelineMember<E>) =>
    b.event.created_at - a.event.created_at || b.sequence - a.sequence;

  return (store) =>
    new Observable<E[]>((subscriber) => {
      const resources = new Subscription();
      const members = new Map<string, TimelineMember<E>>();
      const additions = new Map<string, TimelineMember<E>>();
      const removedIds = new Set<string>();
      const claimed = new Set<E>();
      const pending: TimelineUpdate<E>[] = [];
      let snapshot: E[] = [];
      let sequence = 0;
      let initialized = false;
      let completedStreams = 0;
      let scheduled: Subscription | undefined;

      const claim = (event: E) => {
        if (claimed.has(event)) return;
        claimed.add(event);
        store.claim(event);
      };
      const release = (event: E) => {
        if (claimed.delete(event)) store.removeClaim(event);
      };

      subscriber.add(resources);
      resources.add(() => {
        for (const event of claimed) store.removeClaim(event);
        claimed.clear();
        members.clear();
        additions.clear();
        removedIds.clear();
        pending.length = 0;
        snapshot = [];
      });

      const flush = (force = false) => {
        if (subscriber.closed) return;
        if (additions.size === 0 && removedIds.size === 0) {
          if (force) subscriber.next(snapshot);
          return;
        }

        let next: E[];
        if (members.size === 0) {
          next = [];
        } else if (additions.size <= 1 && removedIds.size <= 1) {
          // Sparse traffic uses native copies and splices instead of sorting or merging the whole timeline
          next = snapshot.slice();
          if (removedIds.size === 1) {
            const removedId = removedIds.values().next().value!;
            const index = next.findIndex((event) => event.id === removedId);
            if (index !== -1) next.splice(index, 1);
          }
          if (additions.size === 1) {
            const event = additions.values().next().value!.event;
            let lower = 0;
            let upper = next.length;
            while (lower < upper) {
              const middle = (lower + upper) >>> 1;
              if (event.created_at >= next[middle].created_at) upper = middle;
              else lower = middle + 1;
            }
            next.splice(lower, 0, event);
          }
        } else if (removedIds.size > members.size * 4) {
          // When almost everything was removed, rebuilding the small remainder avoids scanning discarded history
          next = Array.from(members.values())
            .sort(compareMembers)
            .map((member) => member.event);
        } else {
          const inserted = Array.from(additions.values());
          if (inserted.length > 1) inserted.sort(compareMembers);
          const hasRemovals = removedIds.size > 0;
          if (snapshot.length === 0) {
            next = inserted.map((member) => member.event);
          } else if (
            !hasRemovals &&
            inserted.length > 0 &&
            inserted[inserted.length - 1].event.created_at >= snapshot[0].created_at
          ) {
            // Live bursts often belong entirely before the previous snapshot
            next = inserted.map((member) => member.event).concat(snapshot);
          } else if (
            !hasRemovals &&
            inserted.length > 0 &&
            inserted[0].event.created_at < snapshot[snapshot.length - 1].created_at
          ) {
            // Historical pages often belong entirely after it; native concatenation avoids a JS merge scan
            next = snapshot.concat(inserted.map((member) => member.event));
          } else {
            next = new Array<E>(members.size);
            let insertionIndex = 0;
            let outputIndex = 0;

            for (const event of snapshot) {
              if (hasRemovals && removedIds.has(event.id)) continue;
              // New encounters precede published events with equal timestamps
              while (
                insertionIndex < inserted.length &&
                inserted[insertionIndex].event.created_at >= event.created_at
              ) {
                next[outputIndex++] = inserted[insertionIndex++].event;
              }
              next[outputIndex++] = event;
            }
            while (insertionIndex < inserted.length) next[outputIndex++] = inserted[insertionIndex++].event;
          }
        }

        for (const member of additions.values()) member.published = true;
        additions.clear();
        removedIds.clear();
        snapshot = next;
        // Clear the batch before notifying so reentrant store updates start a new batch
        subscriber.next(snapshot);
      };

      const removeMember = (uid: string, member: TimelineMember<E>) => {
        if (member.published) removedIds.add(member.event.id);
        else additions.delete(uid);
        members.delete(uid);
        release(member.event);
      };

      const apply = (update: TimelineUpdate<E>) => {
        if ("remove" in update) {
          const { uid, id } = update.remove;
          const member = members.get(uid);
          if (member?.event.id === id) removeMember(uid, member);
          return;
        }

        const event = update.insert;
        const uid = getUID(event);
        const existing = members.get(uid);
        if (existing) {
          if (!isNewerVersion(event, existing.event)) return;
          removeMember(uid, existing);
        }

        const member = { event, sequence: sequence++, published: false };
        members.set(uid, member);
        additions.set(uid, member);
        claim(event);
      };

      const finish = () => {
        if (!initialized || completedStreams !== 2 || subscriber.closed) return;
        scheduled?.unsubscribe();
        flush();
        subscriber.complete();
      };
      const update = (change: TimelineUpdate<E>) => {
        if (subscriber.closed) return;
        if (!initialized) {
          // An async snapshot must be reconciled with every update received while it loads
          if ("insert" in change) claim(change.insert);
          pending.push(change);
          return;
        }

        apply(change);
        if (additions.size === 0 && removedIds.size === 0) {
          scheduled?.unsubscribe();
          scheduled = undefined;
          return;
        }
        if (batchWindow === false) flush();
        else if (!scheduled) {
          scheduled = timer(batchWindow).subscribe(() => {
            scheduled = undefined;
            flush();
          });
          resources.add(scheduled);
        }
      };
      const complete = () => {
        completedStreams++;
        finish();
      };

      // Subscribe before reading so async stores cannot lose changes between query and live subscription
      resources.add(
        store.insert$.subscribe({
          next: (event) => {
            if (matches(event)) update({ insert: event });
          },
          error: (error) => subscriber.error(error),
          complete,
        }),
      );
      resources.add(
        store.remove$.subscribe({
          next: (event) => {
            if (matches(event)) update({ remove: { uid: getUID(event), id: event.id } });
          },
          error: (error) => subscriber.error(error),
          complete,
        }),
      );

      const initialize = (events: E[]) => {
        if (subscriber.closed) return;
        // Select initial winners without claiming discarded history or re-sorting the store's snapshot
        for (let index = 0; index < events.length; index++) {
          const event = events[index];
          const uid = getUID(event);
          const existing = members.get(uid);
          if (!existing || isNewerVersion(event, existing.event)) {
            members.set(uid, { event, sequence: events.length - index, published: false });
          }
        }
        sequence = events.length + 1;
        snapshot = new Array<E>(members.size);
        let outputIndex = 0;
        for (const event of events) {
          const member = members.get(getUID(event));
          if (member?.event === event && !member.published) {
            snapshot[outputIndex++] = event;
            member.published = true;
            claim(event);
          }
        }

        for (const change of pending) apply(change);
        pending.length = 0;
        for (const event of claimed) {
          if (members.get(getUID(event))?.event !== event) release(event);
        }

        initialized = true;
        flush(true);
        finish();
      };

      if (!subscriber.closed) {
        try {
          const initial = store.getTimeline(filters);
          if (initial instanceof Promise) initial.then(initialize).catch((error) => subscriber.error(error));
          else initialize(initial);
        } catch (error) {
          subscriber.error(error);
        }
      }
    });
}

/** Returns a cache key that shares equivalent filter shapes and legacy or explicit options */
TimelineModel.getKey = (filters: Filter | Filter[], options: boolean | TimelineOptions = false) =>
  hash_sum([Array.isArray(filters) ? filters : [filters], normalizeTimelineOptions(options)]);
