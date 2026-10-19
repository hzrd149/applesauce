import equal from "fast-deep-equal";
import {
  BehaviorSubject,
  Observable,
  Subject,
  combineLatest,
  defer,
  distinctUntilChanged,
  map,
  startWith,
  timer,
} from "rxjs";
import { getEventHash, type NostrEvent, verifyEvent } from "nostr-tools/pure";
import { LRU } from "../helpers/lru.js";
import { isEvent } from "../helpers/event.js";
import { getSeenRelays } from "../helpers/relays.js";

/** Storage for serialized relay verification evidence, compatible with localStorage and localForage */
export interface OptimisticVerifierStorage {
  /** Returns the serialized evidence for a storage key */
  getItem(key: string): string | null | Promise<string | null>;
  /** Stores serialized evidence for a storage key */
  setItem(key: string, value: string): unknown;
}

/** Options for relay trust growth, signature sampling, and persistence */
export interface OptimisticEventVerifierOptions {
  /** The optional storage adapter for relay evidence */
  storage?: OptimisticVerifierStorage;
  /** The minimum signature verification probability, greater than zero and at most one (default 0.1) */
  minimumVerificationRate?: number;
  /** The successful checks required for full volume confidence (default 10000) */
  verifiedEventsForTrust?: number;
  /** The qualifying UTC days required for full time confidence (default 14) */
  daysForTrust?: number;
  /** The successful checks required for a UTC day to qualify (default 20) */
  verifiedEventsPerDay?: number;
  /** The number of UTC days of evidence to retain, at least daysForTrust (default 30) */
  historyDays?: number;
  /** The maximum entries in each recent-verification cache (default 10000) */
  cacheSize?: number;
}

// `reset` is the time of the last detected invalid event, used to keep resets durable across instances
type Evidence = { version: 1; days: [number, number][]; reset?: number };
type RelayState = {
  evidence: Evidence;
  ready: boolean;
  dirty: boolean;
  writing: boolean;
  changes: BehaviorSubject<void>;
};
const DAY = 86_400_000;
const PREFIX = "applesauce:optimistic-verifier:v1:";

/** A daily count of distinct successfully checked events used as trust evidence */
export interface RelayVerificationHistory {
  /** The UTC day as a Unix timestamp in milliseconds */
  readonly timestamp: number;
  /** The number of successful checks credited during the day */
  readonly verified: number;
}

/** A snapshot of a relay's rolling verification evidence and sampling policy */
export interface RelayVerificationState {
  /** The relay URL supplied by seen-relay metadata */
  readonly relay: string;
  /** Whether persisted evidence has finished loading */
  readonly ready: boolean;
  /** The trust score between zero and one */
  readonly trust: number;
  /** The probability of checking a new signature between zero and one */
  readonly verificationProbability: number;
  /** The number of successful checks in the rolling evidence window */
  readonly verified: number;
  /** The daily evidence retained within the configured history window */
  readonly history: readonly RelayVerificationHistory[];
}

/** The outcome of a single call to {@link OptimisticEventVerifier.verifyEvent} */
export interface OptimisticVerification {
  /** The event that was checked */
  readonly event: NostrEvent;
  /** The seen relays used to pick the sampling probability */
  readonly relays: readonly string[];
  /** The probability of checking the signature, or one when the event failed before sampling */
  readonly probability: number;
  /** Whether the signature was checked, accepted optimistically, found in the recent cache, or rejected */
  readonly result: "verified" | "skipped" | "cached" | "invalid";
}

/** An event verifier that gradually samples signatures using seen-relay evidence */
export class OptimisticEventVerifier {
  private readonly states = new Map<string, RelayState>();
  private readonly verified: LRU<boolean>;
  private readonly credited: LRU<boolean>;
  private readonly options: Required<Omit<OptimisticEventVerifierOptions, "storage">>;
  private readonly storage?: OptimisticVerifierStorage;
  private readonly knownRelays = new BehaviorSubject<readonly string[]>([]);
  private readonly verifications = new Subject<OptimisticVerification>();
  private readonly dailyCap: number;

  /** The URLs of relays encountered or explicitly observed by this instance */
  readonly relays$ = this.knownRelays.asObservable();

  /** Emits the outcome of every verification, useful for metrics and visualizing signature savings */
  readonly verifications$ = this.verifications.asObservable();

  /**
   * Creates a verifier with configurable trust growth and optional persistent relay evidence
   * @throws {RangeError} if rates, counts, or retention settings are invalid
   */
  constructor(options: OptimisticEventVerifierOptions = {}) {
    this.storage = options.storage;
    this.options = {
      minimumVerificationRate: options.minimumVerificationRate ?? 0.1,
      verifiedEventsForTrust: options.verifiedEventsForTrust ?? 10_000,
      daysForTrust: options.daysForTrust ?? 14,
      verifiedEventsPerDay: options.verifiedEventsPerDay ?? 20,
      historyDays: options.historyDays ?? 30,
      cacheSize: options.cacheSize ?? 10_000,
    };
    for (const [key, value] of Object.entries(this.options)) {
      if (key === "minimumVerificationRate") {
        if (!(value > 0 && value <= 1)) throw new RangeError(`${key} must be greater than zero and at most one`);
      } else if (!Number.isSafeInteger(value) || value <= 0) {
        throw new RangeError(`${key} must be a positive safe integer`);
      }
    }
    if (this.options.historyDays < this.options.daysForTrust) {
      throw new RangeError("historyDays must be at least daysForTrust");
    }
    // Spread volume across the required days so a single burst cannot satisfy the volume requirement.
    this.dailyCap = Math.max(
      Math.ceil(this.options.verifiedEventsForTrust / this.options.daysForTrust),
      this.options.verifiedEventsPerDay,
    );
    this.verified = new LRU<boolean>(this.options.cacheSize);
    this.credited = new LRU<boolean>(this.options.cacheSize);
  }

  /** Returns a current relay snapshot and starts loading its persisted evidence */
  getRelayState(url: string): RelayVerificationState {
    const state = this.getState(url);
    const day = Math.floor(Date.now() / DAY);
    this.prune(state.evidence, day);
    const history = state.evidence.days
      .map(([d, verified]) => ({ timestamp: d * DAY, verified }))
      .sort((a, b) => a.timestamp - b.timestamp);
    const verified = history.reduce((sum, bucket) => sum + bucket.verified, 0);
    const trust = this.getTrust(state);
    return {
      relay: url,
      ready: state.ready,
      trust,
      verificationProbability: Math.pow(this.options.minimumVerificationRate, trust),
      verified,
      history,
    };
  }

  /** Observes relay evidence and trust, refreshing at UTC day boundaries while subscribed */
  relay$(url: string): Observable<RelayVerificationState> {
    const state = this.getState(url);
    return combineLatest([state.changes, defer(() => timer(DAY - (Date.now() % DAY), DAY).pipe(startWith(0)))]).pipe(
      map(() => this.getRelayState(url)),
      distinctUntilChanged(equal),
    );
  }

  /** Observes a relay's trust score between zero and one */
  trust$(url: string): Observable<number> {
    return this.relay$(url).pipe(
      map((state) => state.trust),
      distinctUntilChanged(),
    );
  }

  /** Observes a relay's rolling daily verification history */
  history$(url: string): Observable<readonly RelayVerificationHistory[]> {
    return this.relay$(url).pipe(
      map((state) => state.history),
      distinctUntilChanged(equal),
    );
  }

  private getTrust(state: RelayState): number {
    if (!state.ready) return 0;
    this.prune(state.evidence, Math.floor(Date.now() / DAY));
    let count = 0;
    let windows = 0;
    for (const [, n] of state.evidence.days) {
      count += n;
      if (n >= this.options.verifiedEventsPerDay) windows++;
    }
    return Math.min(1, count / this.options.verifiedEventsForTrust, windows / this.options.daysForTrust);
  }

  private prune(evidence: Evidence, day: number) {
    evidence.days = evidence.days.filter(([d]) => d > day - this.options.historyDays && d <= day);
  }

  private parse(raw: string | null): Evidence | null {
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.version !== 1 || !Array.isArray(parsed.days)) return null;
    const days = parsed.days as [number, number][];
    const reset = parsed.reset;
    if (reset !== undefined && !(Number.isSafeInteger(reset) && reset >= 0)) return null;
    if (
      !days.every(
        (b) =>
          Array.isArray(b) &&
          b.length === 2 &&
          Number.isSafeInteger(b[0]) &&
          Number.isSafeInteger(b[1]) &&
          b[1] >= 0 &&
          b[1] <= Number.MAX_SAFE_INTEGER,
      ) ||
      new Set(days.map(([d]) => d)).size !== days.length
    )
      return null;
    // Clamp buckets written under older options or by other code to the current daily cap.
    return {
      version: 1,
      days: days.map(([d, n]) => [d, Math.min(n, this.dailyCap)]),
      ...(reset !== undefined && { reset }),
    };
  }

  private persist(url: string, state: RelayState) {
    if (!this.storage || !state.ready) return;
    state.dirty = true;
    if (state.writing) return;
    state.writing = true;
    void Promise.resolve().then(async () => {
      try {
        while (state.dirty) {
          state.dirty = false;
          // Adopt a newer reset from another instance sharing this storage instead of overwriting it.
          let stored: Evidence | null = null;
          try {
            stored = this.parse(await this.storage!.getItem(PREFIX + url));
          } catch {
            // Unreadable storage is replaced by local evidence.
          }
          if (stored && (stored.reset ?? 0) > (state.evidence.reset ?? 0)) {
            state.evidence = stored;
            state.changes.next();
          }
          await this.storage!.setItem(PREFIX + url, JSON.stringify(state.evidence));
        }
      } catch {
        // Persistence failures must not interrupt event ingestion.
      } finally {
        state.writing = false;
      }
    });
  }

  private getState(url: string): RelayState {
    let state = this.states.get(url);
    if (state) return state;
    state = {
      evidence: { version: 1, days: [] },
      ready: !this.storage,
      dirty: false,
      writing: false,
      changes: new BehaviorSubject<void>(undefined),
    };
    this.states.set(url, state);
    this.knownRelays.next([...this.states.keys()]);
    const current = state;
    if (this.storage) {
      // Defer reads as well so synchronous storage exceptions use the same recovery path.
      void Promise.resolve().then(async () => {
        try {
          const stored = this.parse(await this.storage!.getItem(PREFIX + url));
          // A failure observed during hydration takes precedence over stored evidence.
          if (stored && !current.dirty) current.evidence = stored;
        } catch {
          // Missing, corrupt, or unavailable storage starts with no trust.
        } finally {
          current.ready = true;
          current.changes.next();
          if (current.dirty) this.persist(url, current);
        }
      });
    }
    return current;
  }

  /** Checks an event for store insertion, accepting some signatures optimistically without marking them verified */
  readonly verifyEvent = (event: NostrEvent): boolean => {
    const relays = getSeenRelays(event);
    const sources = relays ? Array.from(relays, (url) => ({ url, state: this.getState(url) })) : [];
    const day = Math.floor(Date.now() / DAY);
    let probability = 1;
    const report = (result: OptimisticVerification["result"]) =>
      this.verifications.next({ event, relays: sources.map((s) => s.url), probability, result });
    const fail = () => {
      for (const { url, state } of sources) {
        state.evidence = { version: 1, days: [], reset: Date.now() };
        state.dirty = true;
        this.persist(url, state);
        state.changes.next();
      }
      report("invalid");
      return false;
    };

    try {
      if (!isEvent(event) || getEventHash(event) !== event.id) return fail();
    } catch {
      return fail();
    }

    const key = event.id + event.sig;
    if (this.verified.get(key)) {
      report("cached");
      return true;
    }
    probability = sources.length ? 0 : 1;
    for (const { state } of sources) {
      probability = Math.max(probability, Math.pow(this.options.minimumVerificationRate, this.getTrust(state)));
    }
    // Web Crypto makes the sampling decision unpredictable to the relay.
    if (probability < 1 && crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 >= probability) {
      report("skipped");
      return true;
    }

    // A fresh object prevents a caller's cached verifiedSymbol from bypassing the actual check.
    const clean: NostrEvent = {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: event.kind,
      tags: event.tags,
      content: event.content,
      sig: event.sig,
    };
    try {
      if (!verifyEvent(clean)) return fail();
    } catch {
      return fail();
    }
    this.verified.set(key, true);
    report("verified");
    if (this.credited.get(event.id)) return true;
    this.credited.set(event.id, true);
    for (const { url, state } of sources) {
      // Avoid merging evidence collected while asynchronous hydration is outstanding.
      if (!state.ready) continue;
      let bucket = state.evidence.days.find(([d]) => d === day);
      if (!bucket) state.evidence.days.push((bucket = [day, 0]));
      bucket[1] = Math.min(this.dailyCap, bucket[1] + 1);
      this.persist(url, state);
      state.changes.next();
    }
    return true;
  };
}
