import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { distinctUntilChanged, isObservable, Observable, of, startWith, Subscription, BehaviorSubject } from "rxjs";

/**
 * The transport-only `extraRelays` option shape every Concord engine's options
 * interface reuses: either a static list or a live stream of relay URLs. This
 * set is NEVER merged into a community's protocol relay set (`material.relays`,
 * `CommunityMetadata.relays`) — it only ever widens which relays an engine
 * additionally *dials* for its own reads/writes (D-01). It is purely additive:
 * with no extras supplied, every merge is an identity over the base set (D-14).
 */
export type ExtraRelaysOption = string[] | Observable<string[]>;

/** Content equality for relay-URL arrays, order-insensitive. Mirrors the
 *  `sameSet` comparator convention used elsewhere in concord's client layer
 *  (see `packages/concord/src/client/community.ts`), so an array rebuilt with
 *  the same members in a different order/instance does not read as a change. */
export function sameRelaySet(a: string[], b: string[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  const set = new Set(a);
  for (const value of b) if (!set.has(value)) return false;
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
 */
export function toRelaysObservable(option?: ExtraRelaysOption): Observable<string[]> {
  const source = isObservable(option) ? option : of(option ?? []);
  return source.pipe(startWith([] as string[]), distinctUntilChanged(sameRelaySet));
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
    this.subscription = toRelaysObservable(option).subscribe((relays) => this.subject.next(relays));
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
    return mergeRelaySets(base, this.current);
  }

  /** Unsubscribes from the source Observable and completes the subject. A
   *  value pushed on the source after this call no longer changes `.current`. */
  dispose(): void {
    this.subscription.unsubscribe();
    this.subject.complete();
  }
}
