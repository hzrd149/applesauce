import { logger } from "applesauce-core";
import { normalizeURL } from "applesauce-core/helpers/url";
import { BehaviorSubject, distinctUntilChanged, map, Observable, skip } from "rxjs";
import { RelayGroupError } from "./group.js";
import type { RelayPool } from "./pool.js";
import { RelayConnectionError, RelayFirstResponseTimeoutError, type Relay } from "./relay.js";

/** A source of temporary relay exclusions for filtering operators */
export interface RelayLivenessSource {
  /** An observable of relays temporarily excluded from selection */
  unhealthy$: Observable<string[]>;
  /** The relay hints encountered by consumers */
  seen?: Set<string>;
  /** Removes relays this source currently excludes from a relay list */
  filter?(relays: string[]): string[];
  /** Starts tracking a pool's relays, called by {@link RelayPool} when the source is passed as an option */
  connectToPool?(pool: RelayPool): void;
}

/** A liveness source that can filter relay lists synchronously, required by the {@link RelayPool} liveness option */
export interface PoolLivenessSource extends RelayLivenessSource {
  /** Removes relays this source currently excludes from a relay list */
  filter(relays: string[]): string[];
}

/** Relay health states for liveness tracking */
export type RelayHealthState = "online" | "offline" | "dead";

/** State information for a relay's health tracking */
export interface RelayState {
  /** Current relay health state */
  state: RelayHealthState;
  /** Timestamp of the first failure in the current streak */
  firstFailureTime?: number;
  /** Number of consecutive failures */
  failureCount: number;
  /** Timestamp of last failure */
  lastFailureTime: number;
  /** Timestamp of last success */
  lastSuccessTime: number;
  /** When the backoff period ends (timestamp) */
  backoffUntil?: number;
}

/** Storage adapter interface for persisting relay liveness state */
export interface LivenessStorage {
  /**
   * Get an item from storage
   * @param key The storage key
   * @returns The stored value or null if not found
   */
  getItem(key: string): Promise<any> | any;
  /**
   * Set an item in storage
   * @param key The storage key
   * @param value The value to store
   */
  setItem(key: string, value: any): Promise<void> | void;
}

/** Configuration options for RelayLiveness */
export interface LivenessOptions {
  /** Minimum failure streak duration before temporary dead classification (ms) */
  minFailureDuration?: number;
  /** Maximum age of another relay success used to corroborate connectivity (ms) */
  connectivityWindow?: number;
  /** Maximum gap between failures in the same streak (ms) */
  failureWindow?: number;
  /** Retry delay for temporarily dead relays (ms) */
  deadRetryDelay?: number;
  /** Grace period after network recovery or foregrounding (ms) */
  recoveryGracePeriod?: number;
  /** Optional async storage adapter for persistence */
  storage?: LivenessStorage;
  /** Maximum failures before moving from offline to dead */
  maxFailuresBeforeDead?: number;
  /** Base delay for exponential backoff (ms) */
  backoffBaseDelay?: number;
  /** Maximum backoff delay (ms) */
  backoffMaxDelay?: number;
}

/** Record and manage liveness reports for relays */
export class RelayLiveness implements RelayLivenessSource {
  private log = logger.extend("RelayLiveness");
  private readonly options: Required<Omit<LivenessOptions, "storage">>;
  private readonly states$ = new BehaviorSubject<Record<string, RelayState>>({});

  /** Relays that have been seen this session. this should be used when checking dead relays for liveness */
  public readonly seen = new Set<string>();
  /** Storage adapter for persistence */
  public readonly storage?: LivenessStorage;

  /** An observable of all relays that are online */
  public online$: Observable<string[]>;
  /** An observable of all relays that are offline */
  public offline$: Observable<string[]>;
  /** An observable of all relays that are dead */
  public dead$: Observable<string[]>;

  /** An observable of all relays that are online or not in backoff */
  public healthy$: Observable<string[]>;
  /** An observable of all relays that are dead or in backoff */
  public unhealthy$: Observable<string[]>;

  /** Relays that are known to be online */
  get online(): string[] {
    return Object.keys(this.states$.value).filter((relay) => this.states$.value[relay].state === "online");
  }
  /** Relays that are known to be offline */
  get offline(): string[] {
    return Object.keys(this.states$.value).filter((relay) => this.states$.value[relay].state === "offline");
  }
  /** Relays that are known to be dead */
  get dead(): string[] {
    return Object.keys(this.states$.value).filter((relay) => this.states$.value[relay].state === "dead");
  }

  /** Relays that are online or not in backoff */
  get healthy(): string[] {
    return Object.keys(this.states$.value).filter((relay) => {
      const state = this.states$.value[relay];
      return state.state === "online" || (state.state === "offline" && !this.isInBackoff(relay));
    });
  }
  /** Relays that are dead or in backoff */
  get unhealthy(): string[] {
    return Object.keys(this.states$.value).filter((relay) => {
      const state = this.states$.value[relay];
      return state.state === "dead" || (state.state === "offline" && this.isInBackoff(relay));
    });
  }

  /**
   * Create a new RelayLiveness instance
   * @param options Configuration options for the liveness tracker
   * @throws if an option is outside its supported range
   */
  constructor(options: LivenessOptions = {}) {
    this.options = {
      minFailureDuration: options.minFailureDuration ?? 10 * 60_000,
      connectivityWindow: options.connectivityWindow ?? 60_000,
      failureWindow: options.failureWindow ?? 30 * 60_000,
      deadRetryDelay: options.deadRetryDelay ?? 60 * 60_000,
      recoveryGracePeriod: options.recoveryGracePeriod ?? 15_000,
      maxFailuresBeforeDead: options.maxFailuresBeforeDead ?? 5,
      backoffBaseDelay: options.backoffBaseDelay ?? 30 * 1000, // 30 seconds
      backoffMaxDelay: options.backoffMaxDelay ?? 5 * 60 * 1000, // 5 minutes
    };
    for (const [name, value] of Object.entries(this.options)) {
      if (!Number.isFinite(value) || value < 0 || value > 2_147_483_647)
        throw new RangeError(`${name} must be a finite nonnegative timer-safe number`);
    }
    if (!Number.isInteger(this.options.maxFailuresBeforeDead) || this.options.maxFailuresBeforeDead < 1)
      throw new RangeError("maxFailuresBeforeDead must be a positive integer");
    this.storage = options.storage;
    if (typeof window !== "undefined") {
      this.networkAvailable = window.navigator.onLine !== false;
      const offline = () => this.setNetworkAvailable(false);
      const online = () => this.setNetworkAvailable(true);
      const visibility = () => {
        if (document.visibilityState === "visible") this.recoverNetwork();
      };
      window.addEventListener("offline", offline);
      window.addEventListener("online", online);
      document.addEventListener("visibilitychange", visibility);
      this.browserCleanup = () => {
        window.removeEventListener("offline", offline);
        window.removeEventListener("online", online);
        document.removeEventListener("visibilitychange", visibility);
      };
    }

    // Create observable interfaces
    this.online$ = this.states$.pipe(
      map((states) => Object.keys(states).filter((relay) => states[relay].state === "online")),
    );
    this.offline$ = this.states$.pipe(
      map((states) => Object.keys(states).filter((relay) => states[relay].state === "offline")),
    );
    this.dead$ = this.states$.pipe(
      map((states) => Object.keys(states).filter((relay) => states[relay].state === "dead")),
    );

    this.healthy$ = this.states$.pipe(
      map((states) =>
        Object.keys(states).filter((relay) => {
          const state = states[relay];
          return state.state === "online" || (state.state === "offline" && !this.isInBackoff(relay));
        }),
      ),
    );
    this.unhealthy$ = this.states$
      .pipe(
        map((states) =>
          Object.keys(states).filter((relay) => {
            const state = states[relay];
            return state.state === "dead" || (state.state === "offline" && this.isInBackoff(relay));
          }),
        ),
      )
      .pipe(distinctUntilChanged((a, b) => a.length === b.length && a.every((url, i) => url === b[i])));
  }

  /** Load relay states from storage */
  async load(): Promise<void> {
    if (!this.storage) return;

    let known: unknown;
    try {
      known = await this.storage.getItem("known");
    } catch {
      return;
    }
    if (!Array.isArray(known)) return;
    const now = Date.now();
    for (const relay of known) {
      if (typeof relay !== "string") continue;
      try {
        const key = normalizeURL(relay);
        const state = await this.storage.getItem(relay);
        // Never overwrite evidence collected while asynchronous storage was loading.
        if (this.getState(key) || !state || !["online", "offline", "dead"].includes(state.state)) continue;
        if (
          ![state.failureCount, state.lastFailureTime, state.lastSuccessTime].every(
            (value) => Number.isFinite(value) && value >= 0,
          )
        )
          continue;
        const recent = state.lastFailureTime <= now && now - state.lastFailureTime < this.options.failureWindow;
        const until = Number.isFinite(state.backoffUntil)
          ? Math.min(state.backoffUntil, now + this.options.backoffMaxDelay)
          : now;
        const restored: RelayState = {
          state: "offline",
          failureCount: recent ? state.failureCount : 0,
          lastFailureTime: recent ? state.lastFailureTime : 0,
          lastSuccessTime: Math.min(now, state.lastSuccessTime),
          backoffUntil: recent && until > now ? until : undefined,
        };
        this.updateRelayState(key, restored);
      } catch {
        // Ignore invalid URLs and unreadable records.
      }
    }
  }

  /** Save all known relays and their states to storage */
  async save(): Promise<void> {
    await this.saveKnownRelays();
    await Promise.all(Object.entries(this.states$.value).map(([relay, state]) => this.saveRelayState(relay, state)));
    this.log("Relay states saved to storage");
  }

  /** Filter relay list, removing dead relays and relays in backoff */
  filter(relays: string[]): string[] {
    const results: string[] = [];

    for (const relay of relays) {
      // Track that this relay has been seen
      this.seen.add(relay);

      const state = this.getState(relay);

      // Filter based on state and backoff
      switch (state?.state) {
        case undefined: // unknown state
        case "online":
          results.push(relay);
          break;
        case "offline":
          // Only include if not in backoff
          if (!this.isInBackoff(relay)) results.push(relay);
          break;
        case "dead":
        default:
          // Don't include dead relays
          break;
      }
    }

    return results;
  }

  /** Subscribe to a relays state */
  state(relay: string): Observable<RelayState | undefined> {
    relay = normalizeURL(relay);
    return this.states$.pipe(map((states) => states[relay]));
  }

  /** Revive a dead relay with the max backoff delay */
  revive(relay: string) {
    relay = normalizeURL(relay);
    const state = this.getState(relay);
    if (!state) return;

    this.updateRelayState(relay, {
      state: "offline",
      failureCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: state.lastSuccessTime,
      backoffUntil: Date.now() + this.options.backoffMaxDelay,
    });

    this.log(`Relay ${relay} revived to offline state with max backoff delay`);
  }

  /** Get current relay health state for a relay */
  getState(relay: string): RelayState | undefined {
    return this.states$.value[normalizeURL(relay)];
  }

  /** Check if a relay is currently in backoff period */
  isInBackoff(relay: string): boolean {
    const state = this.getState(relay);
    if (!state?.backoffUntil) return false;
    return Date.now() < state.backoffUntil;
  }

  /** Get remaining backoff time for a relay (in ms) */
  getBackoffRemaining(relay: string): number {
    const state = this.getState(relay);
    if (!state?.backoffUntil) return 0;
    return Math.max(0, state.backoffUntil - Date.now());
  }

  /** Calculate backoff delay based on failure count */
  private calculateBackoffDelay(failureCount: number): number {
    const delay = this.options.backoffBaseDelay * Math.pow(2, failureCount - 1);
    return Math.min(delay, this.options.backoffMaxDelay);
  }

  /**
   * Record a successful connection
   * @param relay The relay URL that succeeded
   */
  recordSuccess(relay: string): void {
    relay = normalizeURL(relay);
    const now = Date.now();
    const state = this.getState(relay);
    this.seen.add(relay);
    this.successes.set(relay, now);
    // Avoid state copies and storage writes for every message on busy relays.
    if (state?.state === "online" && now - state.lastSuccessTime < Math.max(1000, this.options.connectivityWindow / 2))
      return;

    const newState: RelayState = {
      state: "online",
      failureCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: now,
    };

    this.updateRelayState(relay, newState);

    // Log transition if it's not the first time we've seen the relay
    if (state && state.state !== newState.state) this.log(`Relay ${relay} transitioned ${state?.state} -> online`);
  }

  /** Records transport failures from requests while ignoring policy errors and ambiguous deadlines */
  recordRequestFailure(relay: string, error: unknown, startedAt?: number): void {
    relay = normalizeURL(relay);
    const visited = new Set<unknown>();
    while (error instanceof RelayGroupError) {
      if (visited.has(error)) return;
      visited.add(error);
      const outcome = Object.entries(error.outcomes).find(([url]) => normalizeURL(url) === relay)?.[1];
      if (!outcome || outcome.ok) return;
      error = outcome.error;
    }
    if (startedAt !== undefined && (this.successes.get(normalizeURL(relay)) ?? 0) > startedAt) return;
    if (
      error instanceof RelayConnectionError ||
      error instanceof RelayFirstResponseTimeoutError ||
      (typeof error === "object" && error !== null && "wasClean" in error && error.wasClean === false)
    )
      this.recordFailure(relay);
  }

  /**
   * Record a failed connection
   * @param relay The relay URL that failed
   */
  recordFailure(relay: string): void {
    relay = normalizeURL(relay);
    if (
      !this.networkAvailable ||
      Date.now() < this.recoveryUntil ||
      (typeof document !== "undefined" && document.visibilityState === "hidden")
    )
      return;
    const state = this.getState(relay);

    // Don't update dead relays
    if (state?.state === "dead") return;

    // Ignore failures during backoff, this should help catch double reporting of failures
    if (this.isInBackoff(relay)) return;

    const now = Date.now();
    const recent = state && now - state.lastFailureTime < this.options.failureWindow;
    const failureCount = (recent ? state.failureCount : 0) + 1;
    const firstFailureTime = recent ? (state.firstFailureTime ?? now) : now;
    const corroborated = [...this.successes].some(
      ([other, time]) =>
        other !== relay &&
        now - time <= this.options.connectivityWindow &&
        // Success before a shared outage cannot corroborate a later failed retry.
        (!state?.failureCount || time > state.lastFailureTime),
    );

    // Record new relays
    if (state === undefined) {
      this.seen.add(relay);
    }

    // Calculate backoff delay
    const dead =
      failureCount >= this.options.maxFailuresBeforeDead &&
      now - firstFailureTime >= this.options.minFailureDuration &&
      corroborated;
    const backoffDelay = dead ? this.options.deadRetryDelay : this.calculateBackoffDelay(failureCount);
    const newState = dead ? "dead" : "offline";

    const relayState: RelayState = {
      state: newState,
      firstFailureTime,
      failureCount,
      lastFailureTime: now,
      lastSuccessTime: state?.lastSuccessTime || 0,
      backoffUntil: now + backoffDelay,
    };

    this.updateRelayState(relay, relayState);

    // Log transition if it's not the first time we've seen the relay
    if (newState !== state?.state) this.log(`Relay ${relay} transitioned ${state?.state} -> ${newState}`);
  }

  // Pending timers that clear a relay's backoff once it ends
  private backoffTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Clears the relay's backoff once it ends so state subscribers see the relay become available */
  private scheduleBackoffEnd(relay: string, delay: number): void {
    clearTimeout(this.backoffTimers.get(relay));
    this.backoffTimers.set(
      relay,
      setTimeout(() => {
        this.backoffTimers.delete(relay);
        const state = this.getState(relay);
        // Only clear a backoff that has ended, a newer failure may have extended it
        if (!state || state.backoffUntil === undefined) return;
        if (state.backoffUntil > Date.now()) {
          this.scheduleBackoffEnd(relay, Math.min(2_147_483_647, state.backoffUntil - Date.now()));
          return;
        }
        this.updateRelayState(relay, { ...state, state: "offline", backoffUntil: undefined });
      }, delay),
    );
  }

  /**
   * Get all seen relays (for debugging/monitoring)
   */
  getSeenRelays(): string[] {
    return Array.from(this.seen);
  }

  /**
   * Reset state for one or all relays
   * @param relay Optional specific relay URL to reset, or reset all if not provided
   */
  reset(relay?: string): void {
    if (relay) {
      relay = normalizeURL(relay);
      clearTimeout(this.backoffTimers.get(relay));
      this.backoffTimers.delete(relay);
      this.successes.delete(relay);
      const newStates = { ...this.states$.value };
      delete newStates[relay];
      this.states$.next(newStates);
      this.seen.delete(relay);
    } else {
      for (const timer of this.backoffTimers.values()) clearTimeout(timer);
      this.backoffTimers.clear();
      this.successes.clear();
      this.states$.next({});
      this.seen.clear();
    }
    void this.saveKnownRelays();
  }

  // The connected pools and cleanup methods
  private connections = new Map<RelayPool, () => void>();

  /** Connect to a {@link RelayPool} instance and track relay connections */
  connectToPool(pool: RelayPool): void {
    if (this.connections.has(pool)) return;
    // Relay cleanup methods
    const relays = new Map<Relay, () => void>();

    // Listen for relays being added
    const attach = (relay: Relay) => {
      if (relays.has(relay)) return;
      // Record seen relays
      this.seen.add(relay.url);

      if (relay.connected && !this.getState(relay.url)?.failureCount) this.recordSuccess(relay.url);
      const open = relay.open$.subscribe(() => {
        if (!this.getState(relay.url)?.failureCount) this.recordSuccess(relay.url);
      });
      const message = relay.message$.subscribe((message) => {
        if (Array.isArray(message) && ["EVENT", "EOSE", "OK", "CLOSED", "AUTH", "NOTICE", "COUNT"].includes(message[0]))
          this.recordSuccess(relay.url);
      });
      const attempts = relay.attempts$.pipe(skip(1)).subscribe((count) => {
        if (count > 0) this.recordFailure(relay.url);
      });
      const close = relay.close$.subscribe((event) => {
        if (event.wasClean === false) this.recordFailure(relay.url);
      });

      // Register the cleanup method
      relays.set(relay, () => {
        open.unsubscribe();
        close.unsubscribe();
        message.unsubscribe();
        attempts.unsubscribe();
      });
    };
    const add = pool.add$.subscribe(attach);
    for (const relay of pool.relays.values()) attach(relay);

    // Listen for relays being removed
    const remove = pool.remove$.subscribe((relay) => {
      const cleanup = relays.get(relay);
      if (cleanup) cleanup();
      relays.delete(relay);
    });

    // register the cleanup method
    this.connections.set(pool, () => {
      add.unsubscribe();
      remove.unsubscribe();
      for (const cleanup of relays.values()) cleanup();
      relays.clear();
    });
  }

  /** Disconnect from a {@link RelayPool} instance */
  disconnectFromPool(pool: RelayPool): void {
    const cleanup = this.connections.get(pool);
    if (cleanup) cleanup();
    this.connections.delete(pool);
  }

  private networkAvailable = true;
  private recoveryUntil = 0;
  private successes = new Map<string, number>();
  private browserCleanup?: () => void;

  /** Sets client connectivity from a platform network signal */
  setNetworkAvailable(available: boolean): void {
    if (available === this.networkAvailable) return;
    this.networkAvailable = available;
    if (available) this.recoverNetwork();
  }

  private recoverNetwork(): void {
    this.recoveryUntil = Date.now() + this.options.recoveryGracePeriod;
    this.successes.clear();
    for (const [relay, state] of Object.entries(this.states$.value)) {
      if (state.state !== "online")
        this.updateRelayState(relay, {
          state: "offline",
          failureCount: 0,
          lastFailureTime: 0,
          lastSuccessTime: state.lastSuccessTime,
        });
    }
  }

  /** Disconnects pools and removes browser listeners and retry timers */
  destroy(): void {
    for (const pool of this.connections.keys()) this.disconnectFromPool(pool);
    this.browserCleanup?.();
    for (const timer of this.backoffTimers.values()) clearTimeout(timer);
    this.backoffTimers.clear();
  }

  private updateRelayState(relay: string, state: RelayState): void {
    clearTimeout(this.backoffTimers.get(relay));
    this.backoffTimers.delete(relay);
    if (state.backoffUntil !== undefined) this.scheduleBackoffEnd(relay, Math.max(0, state.backoffUntil - Date.now()));
    // Install the timer before synchronous subscribers can report another outcome.
    this.states$.next({ ...this.states$.value, [relay]: state });

    // Auto-save to storage
    void this.saveRelayState(relay, this.getState(relay) ?? state);
    void this.saveKnownRelays();
  }

  private writes = Promise.resolve();

  private enqueueWrite(key: string, value: unknown): Promise<void> {
    if (!this.storage) return Promise.resolve();
    const storage = this.storage;
    this.writes = this.writes.then(() => storage.setItem(key, value)).catch(() => {});
    return this.writes;
  }

  private async saveKnownRelays(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.enqueueWrite("known", Object.keys(this.states$.value));
    } catch (error) {
      // Ignore storage errors
    }
  }

  private async saveRelayState(relay: string, state: RelayState): Promise<void> {
    if (!this.storage) return;
    try {
      await this.enqueueWrite(relay, state);
    } catch (error) {
      // Ignore storage errors
    }
  }
}
