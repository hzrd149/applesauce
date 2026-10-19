import { RelayDiscovery, RelayMonitor } from "applesauce-common/casts";
import {
  isValidRelayDiscovery,
  isValidRelayMonitorAnnouncement,
  RELAY_DISCOVERY_KIND,
  RELAY_MONITOR_ANNOUNCEMENT_KIND,
} from "applesauce-common/helpers";
import { castEvent, EventStore, mapEventsToStore } from "applesauce-core";
import { getTagValue, getURLHostname, mergeRelaySets, normalizeToPubkey, normalizeURL } from "applesauce-core/helpers";
import { type RelayLivenessSource, type RelayPool } from "applesauce-relay";
import {
  auditTime,
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  filter,
  map,
  type Observable,
  retry,
  Subscription,
  tap,
  timer,
} from "rxjs";

/** A monitor's scoped observation of relay reachability */
export type Nip66RelayStatus = "online" | "offline" | "unknown";

/** A trusted monitor and the relays carrying its signed observations */
export interface Nip66Monitor {
  /** The trusted monitor's hex public key or npub */
  pubkey: string;
  /** The relays carrying this monitor's announcements and observations */
  relays: string[];
  /** A provider-specific decoder that returns offline only for an explicit failed check */
  interpretReport?: (report: RelayDiscovery, capability: "open" | "read" | "write") => Nip66RelayStatus;
}

/** Options for monitor-backed relay liveness */
export interface Nip66LivenessOptions {
  /** The explicitly trusted monitor identities and event sources */
  monitors: Nip66Monitor[];
  /** The capability required from monitor reports, default read */
  capability?: "open" | "read" | "write";
  /** The client's network transport, default clearnet */
  network?: "clearnet" | "tor" | "i2p" | "loki";
  /** The maximum observation lifetime in milliseconds, default one hour */
  maxAge?: number;
  /** The allowed future clock skew in milliseconds, default one minute */
  maxClockSkew?: number;
  /** The distinct negative publishers required for exclusion, default up to two */
  offlineQuorum?: number;
  /** The maximum initial reports requested per monitor, default 2000 */
  limit?: number;
  /** Whether an active monitor's expired report counts as its offline observation, default false */
  staleAsOffline?: boolean;
}

/** A signed, expiring observation from one trusted monitor */
export interface Nip66RelayObservation {
  /** The trusted publisher's hex public key */
  readonly monitor: string;
  /** The report's reachability result for the configured capability and transport */
  readonly state: Nip66RelayStatus;
  /** The signed report's event ID */
  readonly eventId: string;
  /** The report's observation time in milliseconds */
  readonly observedAt: number;
  /** The time when this observation stops influencing selection */
  readonly expiresAt: number;
}

/** The aggregate state of fresh observations for one relay */
export interface Nip66RelayState {
  /** The consensus reachability result */
  readonly state: Nip66RelayStatus;
  /** The fresh observations supporting this result */
  readonly observations: readonly Nip66RelayObservation[];
}

const UNKNOWN: Nip66RelayState = { state: "unknown", observations: [] };
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((value, i) => value === b[i]);

/** Tracks signed NIP-66 evidence without probing target relays or recording local failures */
export class RemoteMonitorRelayLiveness implements RelayLivenessSource {
  private readonly monitors: Map<string, Nip66Monitor>;
  private readonly options: Required<Omit<Nip66LivenessOptions, "monitors">>;
  private readonly states$ = new BehaviorSubject<Map<string, Nip66RelayState>>(new Map());
  private readonly errorsSubject = new BehaviorSubject<Record<string, string>>({});
  private readonly connections = new Map<RelayPool, Subscription>();
  private readonly storeSubscription: Subscription;
  private reports: RelayDiscovery[] = [];
  private announcements: RelayMonitor[] = [];
  private expiry?: ReturnType<typeof setTimeout>;
  private destroyed = false;
  private refreshAt = Infinity;

  /** The relay hints encountered by filtering consumers */
  readonly seen = new Set<string>();
  /** An observable of fresh positive observations */
  readonly online$: Observable<string[]>;
  /** An observable of exclusions supported by fresh explicit negatives */
  readonly unhealthy$: Observable<string[]>;
  /** An observable of monitored relays currently eligible for selection */
  readonly healthy$: Observable<string[]>;
  /** An observable of transport errors keyed by monitor identity */
  readonly errors$ = this.errorsSubject.asObservable();

  /**
   * Creates an independently usable monitor-backed liveness source
   * @throws if monitors, quorum, durations, or the initial report limit are invalid
   */
  constructor(
    private readonly store: EventStore,
    options: Nip66LivenessOptions,
  ) {
    this.monitors = new Map();
    for (const monitor of options.monitors) {
      const pubkey = normalizeToPubkey(monitor.pubkey);
      const relays = mergeRelaySets(monitor.relays);
      if (!pubkey || relays.length === 0 || this.monitors.has(pubkey))
        throw new RangeError("Monitors must have distinct valid public keys and at least one relay");
      this.monitors.set(pubkey, { ...monitor, pubkey, relays });
    }
    this.options = {
      capability: options.capability ?? "read",
      network: options.network ?? "clearnet",
      maxAge: options.maxAge ?? 3600_000,
      maxClockSkew: options.maxClockSkew ?? 60_000,
      offlineQuorum: options.offlineQuorum ?? Math.min(2, this.monitors.size),
      limit: options.limit ?? 2000,
      staleAsOffline: options.staleAsOffline ?? false,
    };
    if (
      this.monitors.size === 0 ||
      !Number.isInteger(this.options.offlineQuorum) ||
      this.options.offlineQuorum < 1 ||
      this.options.offlineQuorum > this.monitors.size
    )
      throw new RangeError("offlineQuorum must fit the configured monitor count");
    if (!Number.isInteger(this.options.limit) || this.options.limit < 1)
      throw new RangeError("limit must be a positive integer");
    if (
      !Number.isFinite(this.options.maxAge) ||
      this.options.maxAge <= 0 ||
      this.options.maxAge > 2_147_483_647 ||
      !Number.isFinite(this.options.maxClockSkew) ||
      this.options.maxClockSkew < 0 ||
      this.options.maxClockSkew > 2_147_483_647
    )
      throw new RangeError("Observation durations must be finite timer-safe values");

    this.online$ = this.states$.pipe(
      map(() => this.online),
      distinctUntilChanged(sameList),
    );
    this.unhealthy$ = this.states$.pipe(
      map(() => this.unhealthy),
      distinctUntilChanged(sameList),
    );
    this.healthy$ = this.states$.pipe(
      map(() => this.healthy),
      distinctUntilChanged(sameList),
    );
    const authors = [...this.monitors.keys()];
    // The store validates signatures and owns replaceable-event revisions and removals.
    // Coalesce a downloaded snapshot only after each incoming event has reached the store.
    this.storeSubscription = combineLatest([
      store.timeline({ kinds: [RELAY_DISCOVERY_KIND], authors }),
      store.timeline({ kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND], authors }),
    ])
      .pipe(auditTime(50))
      .subscribe(([reports, announcements]) => {
        this.reports = reports.filter(isValidRelayDiscovery).map((event) => castEvent(event, RelayDiscovery, store));
        this.announcements = announcements
          .filter(isValidRelayMonitorAnnouncement)
          .map((event) => castEvent(event, RelayMonitor, store));
        this.refresh();
      });
  }

  /** Gets relays with fresh positive observations */
  get online(): string[] {
    this.ensureFresh();
    return [...this.states$.value]
      .filter(([, value]) => value.state === "online")
      .map(([url]) => url)
      .sort();
  }
  /** Gets relays excluded by fresh explicit negative consensus */
  get unhealthy(): string[] {
    this.ensureFresh();
    return [...this.states$.value]
      .filter(([, value]) => value.state === "offline")
      .map(([url]) => url)
      .sort();
  }
  /** Gets known relays that are eligible, including unknown observations */
  get healthy(): string[] {
    this.ensureFresh();
    return [...this.states$.value]
      .filter(([, value]) => value.state !== "offline")
      .map(([url]) => url)
      .sort();
  }

  /** Gets fresh monitor consensus, returning unknown when no usable evidence exists */
  getState(relay: string): Nip66RelayState {
    this.ensureFresh();
    try {
      return this.states$.value.get(normalizeURL(relay)) ?? UNKNOWN;
    } catch {
      return UNKNOWN;
    }
  }

  /** Observes monitor consensus for one relay */
  state(relay: string): Observable<Nip66RelayState> {
    return this.states$.pipe(
      map(() => this.getState(relay)),
      distinctUntilChanged(
        (a, b) =>
          a.state === b.state &&
          a.observations.length === b.observations.length &&
          a.observations.every(
            (item, i) =>
              item.eventId === b.observations[i].eventId &&
              item.state === b.observations[i].state &&
              item.expiresAt === b.observations[i].expiresAt,
          ),
      ),
    );
  }

  /** Filters only relays excluded by fresh explicit negative consensus */
  filter(relays: string[]): string[] {
    return relays.filter((relay) => {
      this.seen.add(relay);
      return this.getState(relay).state !== "offline";
    });
  }

  /**
   * Subscribes to configured monitor event sources without tracking or probing target connections
   * @throws if this source has been destroyed
   */
  connectToPool(pool: RelayPool): void {
    if (this.destroyed) throw new Error("RemoteMonitorRelayLiveness has been destroyed");
    if (this.connections.has(pool)) return;
    const connection = new Subscription();
    this.connections.set(pool, connection);
    for (const monitor of this.monitors.values())
      connection.add(
        pool
          .subscription(
            monitor.relays,
            [
              { kinds: [RELAY_MONITOR_ANNOUNCEMENT_KIND], authors: [monitor.pubkey], limit: 1 },
              {
                kinds: [RELAY_DISCOVERY_KIND],
                authors: [monitor.pubkey],
                // Reports are addressable, so without a window each tracked relay returns only its latest report
                ...(this.options.staleAsOffline
                  ? {}
                  : { since: Math.floor((Date.now() - this.options.maxAge) / 1000) }),
                limit: this.options.limit,
              },
            ],
            { eventStore: null, reconnect: 0 },
          )
          .pipe(
            filter(
              (event) =>
                event.pubkey === monitor.pubkey &&
                [RELAY_DISCOVERY_KIND, RELAY_MONITOR_ANNOUNCEMENT_KIND].includes(event.kind),
            ),
            mapEventsToStore(this.store, false),
            tap(() => this.setError(monitor.pubkey)),
            retry({
              delay: (error, count) => {
                this.setError(monitor.pubkey, String(error));
                return timer(Math.min(60_000, 5000 * 2 ** Math.min(4, count - 1)));
              },
            }),
          )
          .subscribe(),
      );
  }

  /** Stops reading monitors from a pool without closing unrelated pool connections */
  disconnectFromPool(pool: RelayPool): void {
    this.connections.get(pool)?.unsubscribe();
    this.connections.delete(pool);
  }

  /** Releases monitor subscriptions, store observers, and expiry timers */
  destroy(): void {
    this.destroyed = true;
    for (const pool of this.connections.keys()) this.disconnectFromPool(pool);
    this.storeSubscription.unsubscribe();
    clearTimeout(this.expiry);
    this.states$.complete();
    this.errorsSubject.complete();
  }

  private setError(monitor: string, error?: string): void {
    const errors = { ...this.errorsSubject.value };
    if (error) errors[monitor] = error;
    else delete errors[monitor];
    if (error === this.errorsSubject.value[monitor]) return;
    this.errorsSubject.next(errors);
    this.refresh();
  }

  private ensureFresh(): void {
    if (!this.destroyed && Date.now() >= this.refreshAt) this.refresh();
  }

  private refresh(): void {
    if (this.destroyed) return;
    clearTimeout(this.expiry);
    const now = Date.now();
    const lifetimes = new Map(
      this.announcements
        .filter((report) => report.event.created_at * 1000 <= now + this.options.maxClockSkew)
        .map((report) => {
          const frequency = report.frequency;
          return [
            report.event.pubkey,
            Number.isFinite(frequency) && frequency! > 0
              ? Math.min(this.options.maxAge, frequency! * 3000)
              : this.options.maxAge,
          ];
        }),
    );
    const latest = new Map<string, Map<string, RelayDiscovery>>();
    for (const report of this.reports) {
      try {
        const url = normalizeURL(report.url!);
        if (!url.startsWith("ws://") && !url.startsWith("wss://")) continue;
        const byMonitor = latest.get(url) ?? new Map<string, RelayDiscovery>();
        const current = byMonitor.get(report.event.pubkey);
        if (
          !current ||
          report.event.created_at > current.event.created_at ||
          (report.event.created_at === current.event.created_at && report.id < current.id)
        )
          byMonitor.set(report.event.pubkey, report);
        latest.set(url, byMonitor);
      } catch {
        /* Non-URL identifiers cannot inform WebSocket reachability. */
      }
    }
    // A monitor that stopped reporting a relay only means something while it still reports other relays
    const active = new Set<string>();
    for (const reports of latest.values())
      for (const [pubkey, report] of reports) {
        const observedAt = report.event.created_at * 1000;
        const expiresAt = observedAt + (lifetimes.get(pubkey) ?? this.options.maxAge);
        if (observedAt <= now + this.options.maxClockSkew && expiresAt > now) active.add(pubkey);
      }

    const states = new Map<string, Nip66RelayState>();
    let nextExpiry = Infinity;
    for (const [url, reports] of latest) {
      const host = getURLHostname(url);
      const observations: Nip66RelayObservation[] = [];
      for (const [pubkey, report] of reports) {
        const observedAt = report.event.created_at * 1000;
        const expiresAt = observedAt + (lifetimes.get(pubkey) ?? this.options.maxAge);
        if (observedAt > now + this.options.maxClockSkew) continue;
        const stale = expiresAt <= now;
        if (stale && !(this.options.staleAsOffline && active.has(pubkey))) continue;
        if (!stale) nextExpiry = Math.min(nextExpiry, expiresAt);
        const network = report.networkType;
        if (
          (network ?? "clearnet") !== this.options.network ||
          (host.endsWith(".onion") && network !== "tor") ||
          (host.endsWith(".i2p") && network !== "i2p")
        )
          continue;
        const monitor = this.monitors.get(pubkey)!;
        let state: Nip66RelayStatus = "unknown";
        // An expired report from an active monitor means its recent checks no longer reach the relay
        if (stale) state = "offline";
        else {
          try {
            if (monitor.interpretReport) state = monitor.interpretReport(report, this.options.capability);
            else {
              const value = getTagValue(report.event, `rtt-${this.options.capability}`);
              if (value?.trim() && Number.isFinite(Number(value)) && Number(value) >= 0) state = "online";
            }
          } catch {
            /* A provider parsing failure leaves the observation unknown. */
          }
        }
        if (!["online", "offline", "unknown"].includes(state)) state = "unknown";
        if (this.errorsSubject.value[pubkey] && state === "offline") state = "unknown";
        observations.push({ monitor: pubkey, state, eventId: report.id, observedAt, expiresAt });
      }
      const state: Nip66RelayStatus = observations.some((report) => report.state === "online")
        ? "online"
        : observations.filter((report) => report.state === "offline").length >= this.options.offlineQuorum
          ? "offline"
          : "unknown";
      states.set(url, { state, observations: observations.sort((a, b) => a.monitor.localeCompare(b.monitor)) });
    }
    this.refreshAt = nextExpiry;
    // Schedule before notifying consumers so synchronous store updates can replace the timer safely.
    if (Number.isFinite(nextExpiry))
      this.expiry = setTimeout(() => this.refresh(), Math.min(2_147_483_647, Math.max(0, nextExpiry - now)));
    this.states$.next(states);
  }
}
