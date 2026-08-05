import {
  BehaviorSubject,
  catchError,
  concat,
  defer,
  distinctUntilChanged,
  EMPTY,
  expand,
  filter,
  finalize,
  from,
  identity,
  ignoreElements,
  map,
  MonoTypeOperatorFunction,
  Observable,
  of,
  OperatorFunction,
  switchMap,
  take,
  tap,
  throwError,
  timeout,
} from "rxjs";

import type { AuthRequirement, RelayAuthContext, RelayAuthHandler, RelayAuthOperation } from "../types.js";

/**
 * Internal-only D-04 operator. NOT barrel-exported from `operators/index.ts` (mirrors `complete-when.ts`'s
 * precedent) — its exports are the internal auth-required signal shape and the operation-clock gate, which
 * would become maintained public API for no consumer benefit. Must NOT import from `../relay.js`; `Relay`
 * injects its error constructors so the value-level dependency stays one-way (relay.ts -> this module).
 */

/** Module-level unique symbol used as the discriminant key for an internal auth-required signal */
const AUTH_REQUIRED_SIGNAL = Symbol("auth-required-signal");

/** Internal value carrying an auth-required signal off the RxJS error channel (D-01) */
export type AuthRequiredSignal = {
  readonly [AUTH_REQUIRED_SIGNAL]: true;
  readonly reason: string;
};

/** Create an {@link AuthRequiredSignal} carrying `reason` */
export function authRequiredSignal(reason: string): AuthRequiredSignal {
  return { [AUTH_REQUIRED_SIGNAL]: true, reason };
}

/** Type guard for {@link AuthRequiredSignal} */
export function isAuthRequiredSignal(value: unknown): value is AuthRequiredSignal {
  return typeof value === "object" && value !== null && (value as Record<PropertyKey, unknown>)[AUTH_REQUIRED_SIGNAL] === true;
}

/**
 * Tracks how many auth phases are currently in flight for one operation subscription. A counter (not a
 * boolean) so overlapping phases within one operation cannot resume the clock early. Gates are created
 * per operation call and hold no relay-scoped state — this is what makes RAUTH-05's concurrency
 * independence structural rather than enforced.
 */
export class AuthPhaseGate {
  private count = new BehaviorSubject(0);

  /** True while at least one auth phase is in flight for this gate */
  readonly active$: Observable<boolean> = this.count.pipe(
    map((n) => n > 0),
    distinctUntilChanged(),
  );

  /** Open the gate for one auth phase */
  begin(): void {
    this.count.next(this.count.value + 1);
  }

  /** Close the gate for one auth phase */
  end(): void {
    this.count.next(Math.max(0, this.count.value - 1));
  }
}

/**
 * Module-level symbol under which an outer operation (`request`, `publish`) hands its {@link AuthPhaseGate}
 * to the inner operation (`req`, `event`) it drives internally, without the gate ever appearing in any
 * public option type.
 */
export const AUTH_PHASE_GATE = Symbol("auth-phase-gate");

/** An object carrying an optional {@link AuthPhaseGate} under the {@link AUTH_PHASE_GATE} key */
export type WithAuthPhaseGate = { [AUTH_PHASE_GATE]?: AuthPhaseGate };

/**
 * A mono-type operator implementing first-emission timeout semantics (matching every operation-level
 * timeout it replaces: `count`'s 10s, `request`'s 30s, `publish`'s `publishTimeout`) whose countdown only
 * advances while `gate` is inactive (D-15). Time spent inside an auth phase does not consume the budget,
 * so the operation gets its full remaining budget for real work once the auth phase closes. `opts.with`
 * mirrors the rxjs `timeout` operator's `with` escape hatch. A non-positive or non-finite budget returns
 * identity (no timeout applied).
 */
export function suspendableTimeout<T>(
  budgetMs: number,
  gate: AuthPhaseGate,
  opts?: { with?: () => Observable<T> },
): MonoTypeOperatorFunction<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return identity;

  return (source: Observable<T>) =>
    new Observable<T>((subscriber) => {
      let remaining = budgetMs;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let armedAt: number | null = null;
      let firstEmitted = false;
      let settled = false;

      const clearTimer = () => {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      };

      const fail = () => {
        if (settled || firstEmitted) return;
        settled = true;
        clearTimer();
        gateSub.unsubscribe();
        sourceSub.unsubscribe();
        if (opts?.with) opts.with().subscribe(subscriber);
        else subscriber.error(new Error("Timeout has occurred"));
      };

      const arm = () => {
        if (settled || firstEmitted) return;
        armedAt = Date.now();
        timer = setTimeout(fail, remaining);
      };

      const disarm = () => {
        if (armedAt !== null) {
          remaining -= Date.now() - armedAt;
          armedAt = null;
        }
        clearTimer();
      };

      const gateSub = gate.active$.subscribe((active) => {
        if (settled || firstEmitted) return;
        if (active) disarm();
        else arm();
      });

      const sourceSub = source.subscribe({
        next: (value) => {
          if (settled) return;
          if (!firstEmitted) {
            firstEmitted = true;
            clearTimer();
          }
          subscriber.next(value);
        },
        error: (err) => {
          if (settled) return;
          settled = true;
          clearTimer();
          subscriber.error(err);
        },
        complete: () => {
          if (settled) return;
          settled = true;
          clearTimer();
          subscriber.complete();
        },
      });

      return () => {
        settled = true;
        clearTimer();
        gateSub.unsubscribe();
        sourceSub.unsubscribe();
      };
    });
}

/** The three terminal-error constructors `authRetry` maps its outcomes to, injected by the caller */
export type AuthRetryErrors = {
  /** Consecutive auth-failure retries exhausted, or `waitForAuth` is `false` */
  exhausted: (reason: string) => unknown;
  /** The caller-supplied `onAuthRequired` handler rejected or threw */
  handler: (reason: string, cause: unknown) => unknown;
  /** A single auth phase exceeded `authTimeout` */
  timeout: (reason: string) => unknown;
};

/** Configuration for the {@link authRetry} operator */
export type AuthRetryConfig = {
  /** The operation label carried on the built {@link RelayAuthContext} */
  operation: RelayAuthOperation;
  /** What auth state to wait for. `false` terminates immediately without invoking the handler (RAUTH-06) */
  waitForAuth?: AuthRequirement;
  /** Invoked once per auth phase, even when `waitForAuth` is already satisfied (D-11) */
  onAuthRequired?: RelayAuthHandler;
  /** Per-phase timeout in ms, or `false` for unbounded. Defaults to 30_000 (D-12/D-13/D-14) */
  authTimeout?: number | false;
  /** Consecutive auth-failure cycles tolerated before giving up. Defaults to 1 (D-03/D-07/RAUTH-03) */
  authRetries?: number;
  /** Builds the {@link RelayAuthContext} handed to `onAuthRequired` for a given CLOSED/NEG-ERR reason */
  buildContext: (reason: string) => RelayAuthContext;
  /** Maps an {@link AuthRequirement} to an observable of whether it is currently satisfied */
  authSatisfied$: (requirement: AuthRequirement) => Observable<boolean>;
  /** The per-operation {@link AuthPhaseGate} opened for the duration of each auth phase */
  gate: AuthPhaseGate;
  /** Optional debug logger */
  log?: (...args: unknown[]) => void;
  /** The three terminal-error constructors this operator's outcomes map to */
  errors: AuthRetryErrors;
};

/**
 * D-04 shared operator. Consumes a stream that may carry {@link AuthRequiredSignal} values and produces a
 * stream that never does — the signal is never thrown and never re-emitted downstream (D-01). Owns handler
 * invocation, the per-phase timeout, retry counting/reset, error mapping, and operation-clock suspension
 * (via `gate`, consumed by {@link suspendableTimeout} at the call site).
 */
export function authRetry<T>(config: AuthRetryConfig): OperatorFunction<T | AuthRequiredSignal, T> {
  const waitForAuth = config.waitForAuth ?? true;
  const authRetries = config.authRetries ?? 1;

  return (source: Observable<T | AuthRequiredSignal>) =>
    defer(() => {
      // Consecutive auth-failure counter. Lives in this per-subscription closure only — no relay-scoped
      // state — so concurrent operations never share or dedupe an auth outcome (RAUTH-05).
      let consecutive = 0;

      const runPhase = (signal: AuthRequiredSignal): Observable<never> => {
        // RAUTH-06: waitForAuth false terminates immediately, handler is never invoked
        if (waitForAuth === false) return throwError(() => config.errors.exhausted(signal.reason));

        // D-03/D-07: retries exhausted, terminal
        if (consecutive >= authRetries) return throwError(() => config.errors.exhausted(signal.reason));

        consecutive++;
        const context = config.buildContext(signal.reason);

        const phase$: Observable<boolean> = defer(() => {
          config.gate.begin();
          config.log?.(`Auth required for ${config.operation}: ${signal.reason}`);

          // D-11: the handler always runs, even if waitForAuth is already satisfied
          const result = config.onAuthRequired?.(context);
          const handled$ = result instanceof Promise ? from(result) : of(undefined);

          return handled$.pipe(
            catchError((cause) => throwError(() => config.errors.handler(signal.reason, cause))),
            switchMap(() =>
              config.authSatisfied$(waitForAuth).pipe(
                filter((satisfied) => satisfied),
                take(1),
              ),
            ),
          );
          // D-15/D-04: close the gate on every exit path (complete, error, unsubscribe)
        }).pipe(finalize(() => config.gate.end()));

        // D-12/D-13/D-14: one clock covering handler execution plus the wait; fresh per phase
        const authTimeout = config.authTimeout;
        const timed$: Observable<boolean> =
          authTimeout === false
            ? phase$
            : phase$.pipe(
                timeout({
                  first: authTimeout ?? 30_000,
                  with: () => throwError(() => config.errors.timeout(signal.reason)),
                }),
              );

        return timed$.pipe(ignoreElements());
      };

      return source.pipe(
        expand((value) =>
          // D-10: no backoff — re-subscribe the source immediately once the phase resolves.
          // `concat` (not switchMap) because `runPhase` is an ignoreElements()-wrapped Observable<never>
          // that only ever completes or errors — it has no `next` emission for switchMap to project on.
          isAuthRequiredSignal(value) ? concat(runPhase(value), source) : EMPTY,
        ),
        // D-01: the raw signal never reaches the subscriber
        filter((value): value is T => !isAuthRequiredSignal(value)),
        // D-08: any real value resets the consecutive counter — a per-cycle budget, not a per-lifetime one
        tap(() => {
          consecutive = 0;
        }),
      );
    });
}
