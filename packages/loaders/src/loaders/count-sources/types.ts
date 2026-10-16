import type { Debugger } from "applesauce-core";
import type { Filter, NostrEvent } from "applesauce-core/helpers";
import type { Observable, SchedulerLike } from "rxjs";
import type { CountRuntime } from "../count-runtime.js";

/** A static or reactive ordered configuration list */
export type CountList<T> = readonly T[] | Observable<readonly T[]>;

/** A target identified by event ID, or an explicitly selected stable address */
export interface CountTarget {
  /** The event ID */
  id: string;

  /** The event creation time in seconds */
  created_at: number;

  /** The event kind */
  kind: number;

  /** The stable address when counting an address instead of a revision */
  address?: string;
}

/** A semantic metric with optional protocol mappings */
export interface CountMetric {
  /** The stable semantic identifier, including a version */
  id: string;

  /** The unit represented by the value */
  unit: "events" | "sats" | "score";

  /** The COUNT filters, or undefined for unsupported targets */
  filters?: (target: CountTarget) => Filter[] | undefined;

  /** The NIP-85 metric tag */
  assertionTag?: string;
}

/** A request for one target and semantic metric */
export interface CountQuery {
  /** The target event or address */
  target: CountTarget;

  /** The requested metric */
  metric: CountMetric;
}

/** The provenance of a selected count */
export interface CountOrigin {
  /** The adapter identity */
  adapter: string;

  /** The selected relay */
  relay: string;

  /** The assertion provider, when applicable */
  provider?: string;
}

/** A successful result from one source */
export interface CountResult {
  /** The nonnegative safe integer value */
  value: number;

  /** The semantic metric identifier */
  metric: string;

  /** The actual source of the value */
  origin: CountOrigin;

  /** Whether the value is approximate */
  approximate?: boolean;

  /** The assertion creation time in seconds, separate from fetch time */
  assertedAt?: number;
}

/** The scheduler used by all transport attempts */
export interface CountTransportScheduler {
  /** Queues a cancellable transport with atomic resource admission */
  run<T>(resources: readonly string[], transport: () => Observable<T>): Observable<T>;
}

/** The shared context for one resolution */
export interface CountContext {
  /** The protocol endpoints already dispatched during this resolution */
  attempts?: Set<string>;

  /** The service-owned batching scope */
  batchScope?: object;

  /** The shared optional routing runtime */
  runtime?: CountRuntime;

  /** Whether routing nodes own branch budgets instead of legacy source timeouts */
  routed?: boolean;

  /** The maximum wait for source capacity in milliseconds */
  selectionTimeout?: number;

  /** The absolute resolution deadline in scheduler milliseconds */
  deadline: number;

  /** The transport admission scheduler */
  transport: CountTransportScheduler;

  /** The RxJS clock used for deadlines and batching */
  clock: SchedulerLike;

  /** The maximum duration of an individual attempt */
  attemptTimeout: number;

  /** The parent logger inherited by source attempts */
  logger?: Debugger;

  /** The optional resolution instrumentation callback */
  diagnostic?: (type: string, latency?: number) => void;

  /** Reports a failed candidate while allowing subsequent fallbacks */
  onFailure?: (error: unknown) => void;
}

/** A finite, cancellable source with a reactive effective policy */
export interface CountSource {
  /** The stable source identity */
  id: string;

  /** Whether this source manages its own transport and selection budgets */
  managed?: boolean;

  /** Observes whether this source supports the query under its configuration */
  supports?: (query: CountQuery) => Observable<boolean>;

  /** Observes support, health, and transport eligibility for routing */
  available?: (query: CountQuery, context: CountContext) => Observable<boolean>;

  /** Returns a policy identity and keeps observing configuration after settlement */
  policy: (query: CountQuery) => Observable<string>;

  /** Returns one result, completes empty when unavailable, or errors */
  count: (query: CountQuery, context: CountContext) => Observable<CountResult>;
}

/** A transport structurally compatible with RelayPool.count */
export type CountRequest = (
  relays: string[],
  filters: Filter[],
) => Observable<
  Record<string, { ok: true; value: { count: number; approximate?: boolean } } | { ok: false; error: unknown }>
>;

/** A trusted NIP-85 provider scoped to the selected metric */
export interface CountProvider {
  /** The algorithm-specific signing key */
  pubkey: string;

  /** The reactive relay routes, compatible with AssertionProvider */
  relays$: Observable<readonly string[]>;
}

/** A finite assertion request whose events are verified before acceptance */
export type AssertionRequest = (relays: string[], filters: Filter[]) => Observable<NostrEvent>;

/** A raw NIP-85 trust declaration compatible with common provider helpers */
export interface CountProviderDeclaration {
  /** The trusted assertion kind */
  kind: number;

  /** The trusted assertion metric tag */
  tag: string;

  /** The algorithm-specific signing key */
  servicePubkey: string;

  /** The declared relay hint */
  relay?: string;
}

/** A structural pool with COUNT and/or finite event request support */
export interface CountPool {
  /** The NIP-45 COUNT transport */
  count?: CountRequest;

  /** The finite event request transport used for NIP-85 assertions */
  request?: AssertionRequest;
}

/** A finite event request method or interoperable pool for the count service */
export type CountUpstream = AssertionRequest | CountPool;
