import { mergeRelaySets } from "applesauce-core/helpers/relays";
import {
  BehaviorSubject,
  catchError,
  distinctUntilChanged,
  isObservable,
  Observable,
  of,
  startWith,
  Subscription,
} from "rxjs";

import { logger } from "../logger.js";

/** Module-scope debug logger for this file, derived once from the package
 *  logger (D-16) — never `.extend()`d again at an individual log call site. */
const log = logger.extend("extra-relays");

/**
 * The transport-only `extraRelays` option shape every Concord engine's options
 * interface reuses: either a static list or a live stream of relay URLs. This
 * set is NEVER merged into a community's protocol relay set (`material.relays`,
 * `CommunityMetadata.relays`) — it only ever widens which relays an engine
 * additionally *dials* for its own reads/writes (D-01). It is purely additive:
 * with no extras supplied, every merge is an identity over the base set (D-14).
 */
export type ExtraRelaysOption = string[] | Observable<string[]>;

/** Content equality for relay-URL arrays, comparing deduplicated membership
 *  (order- and multiplicity-insensitive). Mirrors the `sameSet` comparator
 *  convention used elsewhere in concord's client layer (see
 *  `packages/concord/src/client/community.ts`), so an array rebuilt with the
 *  same members in a different order/instance — or with duplicate entries —
 *  does not read as a change, while a genuine membership difference is never
 *  masked by a duplicate on either side. */
export function sameRelaySet(a: string[], b: string[]): boolean {
  if (a === b) return true;
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const value of setB) if (!setA.has(value)) return false;
  return true;
}

/**
 * Resolves an {@link ExtraRelaysOption} into a continuous stream of relay URLs.
 *
 * This resolver is continuous by design: it deliberately omits the
 * first-value-only operator that applesauce-loaders' one-shot resolution
 * helper applies, because Concord engines are long-lived and must react to
 * every later emission on an extras Observable, not just the first one
 * (D-11) — resolving only the initial value here would silently undo the
 * reactivity D-08/D-09 depend on.
 *
 * `startWith([])` means a source that has not yet emitted (or a static/`undefined`
 * option) resolves to the empty set immediately, so no Concord operation ever
 * blocks waiting on the app's Observable (D-10). `distinctUntilChanged` collapses
 * re-emissions that carry the same members, so churn-free re-emission holds even
 * across the synthetic `startWith` value.
 *
 * An app-supplied source that errors degrades to the empty set rather than
 * propagating: `catchError` substitutes `of([])` ahead of `startWith`, so a
 * failure on an arbitrary app-controlled stream never surfaces as an
 * unhandled error in the host application (D-10's "never blocks Concord
 * traffic" contract).
 */
export function toRelaysObservable(option?: ExtraRelaysOption): Observable<string[]> {
  const source = isObservable(option) ? option : of(option ?? []);
  return source.pipe(
    catchError((error) => {
      log("extras source errored, degrading to the empty relay set: %o", error);
      return of([] as string[]);
    }),
    startWith([] as string[]),
    distinctUntilChanged(sameRelaySet),
  );
}

/**
 * A per-engine holder that resolves an {@link ExtraRelaysOption} into a hot,
 * synchronously-readable snapshot (D-04's "one place resolves the extras
 * snapshot and dedupes"). Each engine constructs its own holder, so if an app
 * wants several engines to share one live extras stream it should pass a hot
 * source (a `BehaviorSubject`, or a `shareReplay(1)`-wrapped Observable) rather
 * than a cold one — otherwise each holder subscribes its own independent
 * execution of the source (D-10's documented consequence).
 */
export class ExtraRelays {
  private readonly subject = new BehaviorSubject<string[]>([]);
  private readonly subscription: Subscription;

  constructor(option?: ExtraRelaysOption) {
    // Defense in depth: `toRelaysObservable` already degrades an errored source
    // to `of([])` via `catchError`, so this `error` handler should never fire.
    // It exists so a future refactor that removes the operator-level guard
    // still leaves this holder degrading instead of crashing the host process.
    // It must NOT error or complete the internal subject - downstream
    // consumers must keep receiving values.
    this.subscription = toRelaysObservable(option).subscribe({
      next: (relays) => this.subject.next(relays),
      error: (error) => {
        log("extras subscription errored unexpectedly, degrading to the empty relay set: %o", error);
        this.subject.next([]);
      },
    });
  }

  /** The resolved extras as a continuous stream — every consumer inside this
   *  engine shares the one subscription created in the constructor. */
  get relays$(): Observable<string[]> {
    return this.subject;
  }

  /** The synchronous snapshot of the currently resolved extras, read with no
   *  `await` — the value every per-operation call site reads (D-11). */
  get current(): string[] {
    return this.subject.value;
  }

  /**
   * Merges `base` with the current extras snapshot, routed entirely through
   * {@link mergeRelaySets} (D-02) — the only place in this module that merges.
   * The result is a transport target set only: it must never be written into
   * signed or published content.
   */
  merge(base: string[]): string[] {
    const merged = mergeRelaySets(base, this.current);
    const rawUnionSize = new Set([...base, ...this.current]).size;
    if (merged.length !== rawUnionSize) {
      log(
        "merge dropped %d unparseable relay URL(s): raw union had %d distinct entries, merged result has %d",
        rawUnionSize - merged.length,
        rawUnionSize,
        merged.length,
      );
    }
    return merged;
  }

  /** Unsubscribes from the source Observable and completes the subject. A
   *  value pushed on the source after this call no longer changes `.current`. */
  dispose(): void {
    this.subscription.unsubscribe();
    this.subject.complete();
  }
}
