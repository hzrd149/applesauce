import { BehaviorSubject, map, Observable } from "rxjs";

/**
 * Relay health states for liveness tracking
 */
export type RelayHealthState = "online" | "testing" | "offline" | "dead";

/**
 * State information for a relay's health tracking
 */
export interface RelayState {
  /** Current relay health state */
  state: RelayHealthState;
}

/**
 * Storage adapter interface for persisting relay liveness state
 */
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

/**
 * Configuration options for RelayLiveness
 */
export interface LivenessOptions {
  /** Optional async storage adapter for persistence */
  storage?: LivenessStorage;
}

/**
 * RelayLiveness tracks relay health using circuit breaker patterns with exponential backoff.
 *
 * This class automatically filters out dead/offline relays while persisting state to storage.
 * It discovers relays passively through usage and doesn't depend on any specific relay implementation.
 *
 * Relay Health States:
 * - online: Relay is healthy and working
 * - offline: Relay is temporarily unavailable but may recover
 * - testing: Relay is being tested after being offline
 * - dead: Relay has failed permanently and is blocked
 * - unknown: New relay with no health data yet
 *
 * @example
 * ```typescript
 * const liveness = new RelayLiveness({
 *   storage: {
 *     getItem: (key) => localStorage.getItem(key),
 *     setItem: (key, value) => localStorage.setItem(key, value)
 *   }
 * });
 * await liveness.init();
 *
 * // Monitor relay connections
 * relay.error$.subscribe((error) => {
 *   if (error) liveness.recordFailure(relay.url, error);
 * });
 * relay.connected$.subscribe((connected) => {
 *   if (connected) liveness.recordSuccess(relay.url);
 * });
 *
 * // Filter relays
 * const healthyRelays = liveness.filter(relayUrls);
 * ```
 */
export class RelayLiveness {
  private readonly options: Required<Omit<LivenessOptions, "storage">> & { storage?: LivenessStorage };
  private readonly states$ = new BehaviorSubject<Record<string, RelayState>>({});
  public readonly storage?: LivenessStorage;

  /** An observable of all relays that are online */
  public online$: Observable<string[]>;
  /** An observable of all relays that are testing */
  public testing$: Observable<string[]>;
  /** An observable of all relays that are offline */
  public offline$: Observable<string[]>;
  /** An observable of all relays that are dead */
  public dead$: Observable<string[]>;

  /** An observable of all relays that are online or testing */
  public healthy$: Observable<string[]>;
  /** An observable of all relays that are offline or dead */
  public unhealthy$: Observable<string[]>;

  /**
   * Create a new RelayLiveness instance
   * @param options Configuration options for the liveness tracker
   */
  constructor(options: LivenessOptions = {}) {
    this.options = {
      ...options,
    };
    this.storage = options.storage;

    // Create observables interfaces
    this.online$ = this.states$.pipe(
      map((states) => Object.keys(states).filter((relay) => states[relay].state === "online")),
    );
    this.testing$ = this.states$.pipe(
      map((states) => Object.keys(states).filter((relay) => states[relay].state === "testing")),
    );
    this.offline$ = this.states$.pipe(
      map((states) => Object.keys(states).filter((relay) => states[relay].state === "offline")),
    );
    this.dead$ = this.states$.pipe(
      map((states) => Object.keys(states).filter((relay) => states[relay].state === "dead")),
    );

    this.healthy$ = this.states$.pipe(
      map((states) =>
        Object.keys(states).filter((relay) => states[relay].state === "online" || states[relay].state === "testing"),
      ),
    );
    this.unhealthy$ = this.states$.pipe(
      map((states) =>
        Object.keys(states).filter((relay) => states[relay].state === "offline" || states[relay].state === "dead"),
      ),
    );
  }

  /** Load relay states from storage */
  async load(): Promise<void> {
    if (!this.storage) return;

    const known = await this.storage.getItem("known");
    if (!Array.isArray(known)) return;

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
  }

  /**
   * Filter relay list, removing dead relays
   * @param relays Array of relay URLs to filter
   * @returns Filtered array of relay URLs
   */
  filter(relays: string[]): string[] {
    const results: string[] = [];

    for (const relay of relays) {
      const state = this.getState(relay);

      // Filter based on state
      switch (state?.state) {
        case undefined: //unknown state
        case "online":
        case "testing":
          results.push(relay);
          break;
        case "dead":
        case "offline":
        default:
          // Don't include dead/offline relays
          break;
      }
    }

    return results;
  }

  /** Get current relay health state for a relay */
  getState(relay: string): RelayState | undefined {
    return this.states$.value[relay];
  }

  /**
   * Record a successful connection
   * @param relay The relay URL that succeeded
   */
  recordSuccess(relay: string): void {
    // state management logic here
  }

  /**
   * Record a failed connection
   * @param relay The relay URL that failed
   * @param _error Optional error object (currently unused but available for future use)
   */
  recordFailure(relay: string, _error?: Error): void {
    // state management logic here
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
    } else {
      // Reset all relays
      this.states$.next({});
    }
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
