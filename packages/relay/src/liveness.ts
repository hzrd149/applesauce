import { logger } from "applesauce-core";
import { BehaviorSubject, map, Observable } from "rxjs";
import { RelayPool } from "./pool.js";
import { IPool, IRelay } from "./types.js";

/** Relay health states for liveness tracking */
export type RelayHealthState = "online" | "offline" | "dead";

/**
 * State information for a relay's health tracking
 */
export interface RelayState {
  /** Current relay health state */
  state: RelayHealthState;
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
export class RelayLiveness {
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
   */
  constructor(options: LivenessOptions = {}) {
    this.options = {
      maxFailuresBeforeDead: options.maxFailuresBeforeDead ?? 5,
      backoffBaseDelay: options.backoffBaseDelay ?? 30 * 1000, // 30 seconds
      backoffMaxDelay: options.backoffMaxDelay ?? 5 * 60 * 1000, // 5 minutes
    };
    this.storage = options.storage;

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
    this.unhealthy$ = this.states$.pipe(
      map((states) =>
        Object.keys(states).filter((relay) => {
          const state = states[relay];
          return state.state === "dead" || (state.state === "offline" && this.isInBackoff(relay));
        }),
      ),
    );
  }

  /** Load relay states from storage */
  async load(): Promise<void> {
    if (!this.storage) return;

    const known = await this.storage.getItem("known");
    if (!Array.isArray(known)) return;

    this.log(`Loading states for ${known.length} known relays`);
    const states: Record<string, RelayState> = {};
    for (const relay of known) {
      try {
        const state = await this.storage.getItem(relay);
        if (state) states[relay] = state as RelayState;
      } catch (error) {
        // Ignore relay loading errors
      }
    }

    this.states$.next(states);
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
    return this.states$.pipe(map((states) => states[relay]));
  }

  /** Revive a dead relay with the max backoff delay */
  revive(relay: string) {
    const state = this.getState(relay);
    if (!state) return;

    this.updateRelayState(relay, {
      state: "offline",
      failureCount: 0,
      lastFailureTime: 0,
      lastSuccessTime: Date.now(),
      backoffUntil: this.options.backoffMaxDelay,
    });

    this.log(`Relay ${relay} revived to offline state with max backoff delay`);
  }

  /** Get current relay health state for a relay */
  getState(relay: string): RelayState | undefined {
    return this.states$.value[relay];
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
    const now = Date.now();
    const state = this.getState(relay);

    // Don't update dead relays
    if (state?.state === "dead") {
      this.log(`Ignoring success for dead relay ${relay}`);
      return;
    }

    // Record new relays
    if (state === undefined) {
      this.seen.add(relay);
      this.saveKnownRelays();
    }

    // TODO: resetting the state back to online might be too aggressive?
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

  /**
   * Record a failed connection
   * @param relay The relay URL that failed
   */
  recordFailure(relay: string): void {
    const state = this.getState(relay);

    // Don't update dead relays
    if (state?.state === "dead") return;

    // Ignore failures during backoff, this should help catch double reporting of failures
    if (this.isInBackoff(relay)) return;

    const now = Date.now();
    const failureCount = (state?.failureCount || 0) + 1;

    // Record new relays
    if (state === undefined) {
      this.seen.add(relay);
      this.saveKnownRelays();
    }

    // Calculate backoff delay
    const backoffDelay = this.calculateBackoffDelay(failureCount);
    const newState = failureCount >= this.options.maxFailuresBeforeDead ? "dead" : "offline";

    const relayState: RelayState = {
      state: newState,
      failureCount,
      lastFailureTime: now,
      lastSuccessTime: state?.lastSuccessTime || 0,
      backoffUntil: now + backoffDelay,
    };

    this.updateRelayState(relay, relayState);

    // Log transition if it's not the first time we've seen the relay
    if (newState !== state?.state) this.log(`Relay ${relay} transitioned ${state?.state} -> ${newState}`);

    // Set a timeout that will clear the backoff period
    setTimeout(() => {
      const state = this.getState(relay);
      if (!state || state.backoffUntil === undefined) return;
      this.updateRelayState(relay, { ...state, backoffUntil: undefined });
    }, backoffDelay);
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
      const newStates = { ...this.states$.value };
      delete newStates[relay];
      this.states$.next(newStates);
      this.seen.delete(relay);
    } else {
      // Reset all relays
      this.states$.next({});
      this.seen.clear();
    }
  }

  // The connected pools and cleanup methods
  private connections = new Map<IPool, () => void>();

  /** Connect to a {@link RelayPool} instance and track relay connections */
  connectToPool(pool: IPool): void {
    // Relay cleanup methods
    const relays = new Map<IRelay, () => void>();

    // Listen for relays being added
    const add = pool.add$.subscribe((relay) => {
      // Record seen relays
      this.seen.add(relay.url);

      const open = relay.open$.subscribe(() => {
        this.recordSuccess(relay.url);
      });
      const close = relay.close$.subscribe((event) => {
        if (event.wasClean === false) this.recordFailure(relay.url);
      });

      // Register the cleanup method
      relays.set(relay, () => {
        open.unsubscribe();
        close.unsubscribe();
      });
    });

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
    });
  }

  /** Disconnect from a {@link RelayPool} instance */
  disconnectFromPool(pool: IPool): void {
    const cleanup = this.connections.get(pool);
    if (cleanup) cleanup();
    this.connections.delete(pool);
  }

  private updateRelayState(relay: string, state: RelayState): void {
    this.states$.next({ ...this.states$.value, [relay]: state });

    // Auto-save to storage
    this.saveRelayState(relay, state);
  }

  private async saveKnownRelays(): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.setItem("known", Object.keys(this.states$.value));
    } catch (error) {
      // Ignore storage errors
    }
  }

  private async saveRelayState(relay: string, state: RelayState): Promise<void> {
    if (!this.storage) return;
    try {
      await this.storage.setItem(relay, state);
    } catch (error) {
      // Ignore storage errors
    }
  }
}
