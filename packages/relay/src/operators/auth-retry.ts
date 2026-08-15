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

import { describeAuthRequirement, describeWireRequest, truncateForLog } from "../helpers/auth-log.js";
import type { AuthRequirement, RelayAuthContext, RelayAuthHandler } from "../types.js";

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
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[AUTH_REQUIRED_SIGNAL] === true
  );
}

/**
 * Answers "does this value represent real progress from the relay, as opposed to a value this call
 * site generated for its own bookkeeping (e.g. `req()`'s synthetic `OPEN`)?" Required — never optional
 * with a permissive default — at every consumer of the shared operator (`authRetry`'s D-08 consecutive-
 * counter reset, `suspendableTimeout`'s first-emission gate) so a future call site that introduces a new
 * bookkeeping value cannot silently re-break the retry bound or the operation clock: omitting the answer
 * is a TypeScript compile error, not a runtime surprise (CR-01/WR-01).
 */
export type ProgressPredicate<T> = (value: T) => boolean;

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
 * so the operation gets its full remaining budget for real work once the auth phase closes. `opts.firstWhen`
 * is a required {@link ProgressPredicate} (CR-01/WR-01) — a value it rejects does not start or cancel the
 * clock, so a call site's own bookkeeping emission (e.g. `req()`'s synthetic `OPEN`) can never prematurely
 * cancel the clock before the relay has actually said anything. `opts.with` mirrors the rxjs `timeout`
 * operator's `with` escape hatch. A non-positive or non-finite budget returns identity (no timeout applied).
 */
export function suspendableTimeout<T>(
  budgetMs: number,
  gate: AuthPhaseGate,
  opts: { firstWhen: ProgressPredicate<T>; with?: () => Observable<T> },
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
        if (opts.with) opts.with().subscribe(subscriber);
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
          // CR-01/WR-01: only a value the predicate accepts as progress starts/cancels the clock; a
          // rejected (bookkeeping) value is still forwarded but never marks first emission.
          if (!firstEmitted && opts.firstWhen(value)) {
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
export type AuthRetryConfig<T> = {
  /** What auth state to wait for. `false` terminates immediately without invoking the handler (RAUTH-06) */
  waitForAuth?: AuthRequirement;
  /** Invoked once per auth phase, even when `waitForAuth` is already satisfied (D-11) */
  onAuthRequired?: RelayAuthHandler;
  /** Per-phase timeout in ms, or `false` for unbounded. Defaults to 30_000 (D-12/D-13/D-14) */
  authTimeout?: number | false;
  /** Consecutive auth-failure cycles tolerated before giving up. Defaults to 1 (D-03/D-07/RAUTH-03) */
  authRetries?: number;
  /**
   * Required (CR-01): answers whether a real (non-signal) stream value represents progress from the
   * relay, as opposed to a call site's own bookkeeping value. Gates the D-08 consecutive-counter reset
   * — a value this rejects does not reset the retry budget, so a call site's bookkeeping emission (e.g.
   * `req()`'s synthetic `OPEN`) can never mask a persistently auth-gated relay.
   */
  isProgress: ProgressPredicate<T>;
  /** Builds the {@link RelayAuthContext} handed to `onAuthRequired` for a given CLOSED/NEG-ERR reason */
  buildContext: (reason: string) => RelayAuthContext;
  /** Maps an {@link AuthRequirement} to an observable of whether it is currently satisfied */
  authSatisfied$: (requirement: AuthRequirement) => Observable<boolean>;
  /**
   * Required (D-08): the pubkeys that currently satisfy `waitForAuth` at the moment `satisfiedPubkeys` is
   * called — the join key an operation track hangs its "now waiting for …" line off. Never optional, never
   * defaulted, mirroring `isProgress`'s CR-01/WR-01 precedent so a call site cannot silently omit the answer.
   */
  satisfiedPubkeys: () => string[];
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
export function authRetry<T>(config: AuthRetryConfig<T>): OperatorFunction<T | AuthRequiredSignal, T> {
  const waitForAuth = config.waitForAuth ?? true;
  const authRetries = config.authRetries ?? 1;

  return (source: Observable<T | AuthRequiredSignal>) =>
    defer(() => {
      // Consecutive auth-failure counter. Lives in this per-subscription closure only — no relay-scoped
      // state — so concurrent operations never share or dedupe an auth outcome (RAUTH-05).
      let consecutive = 0;

      const runPhase = (signal: AuthRequiredSignal): Observable<never> => {
        // D-05: hoisted above both early returns so even a short-circuit path (opted out, retries
        // exhausted) still has a request label to log — buildContext is a pure assembly with no
        // side effects, so moving it earlier is safe.
        const context = config.buildContext(signal.reason);
        const requestLabel = describeWireRequest(context.request);
        // D-05/D-15: every operation-track line shares this one prefix and one call shape.
        function phaseLine(text: string): void {
          config.log?.(`${requestLabel} — ${text}`);
        }

        // RAUTH-06: waitForAuth false terminates immediately, handler is never invoked
        if (waitForAuth === false) {
          phaseLine(
            "relay requires auth for this request but the operation opted out of waiting — no handler is invoked and the request fails",
          );
          return throwError(() => config.errors.exhausted(signal.reason));
        }

        // D-03/D-07: retries exhausted, terminal
        if (consecutive >= authRetries) {
          phaseLine(`auth retry budget of ${authRetries} phase(s) is exhausted — giving up`);
          return throwError(() => config.errors.exhausted(signal.reason));
        }

        consecutive++;
        // D-05: `phase n/N` uses the post-increment counter over the configured budget.
        const phase = `phase ${consecutive}/${authRetries}`;

        const phase$: Observable<boolean> = defer(() => {
          config.gate.begin();
          phaseLine(`entering ${phase}`);

          // D-14: log whether a handler is present before invoking it — two distinct observable
          // states, not one ambiguous line. An absent handler means the operation is waiting on
          // out-of-band auth state (e.g. status$) with no handler in play (D-08).
          if (config.onAuthRequired) phaseLine(`invoking the configured onAuthRequired handler (${phase})`);
          else phaseLine(`no onAuthRequired handler is configured — waiting on external auth state (${phase})`);

          // D-11: the handler always runs, even if waitForAuth is already satisfied
          // CR-04: a handler that throws synchronously must map to the same AuthHandlerError-shaped
          // outcome as a handler that returns a rejected promise — both failure modes are
          // indistinguishable to the caller. Without this try/catch, a synchronous throw here escapes
          // the defer factory above the catchError below and reaches the caller as a raw thrown value.
          let result: void | Promise<void>;
          try {
            result = config.onAuthRequired?.(context);
          } catch (cause) {
            // D-14: distinct from the promise-rejection line below — this tells an operator the
            // handler failed before it ever returned, not after.
            phaseLine(`onAuthRequired threw synchronously (${phase}): ${truncateForLog(cause)}`);
            return throwError(() => config.errors.handler(signal.reason, cause));
          }
          const handled$ = result instanceof Promise ? from(result) : of(undefined);

          return handled$.pipe(
            catchError((cause) => {
              phaseLine(`onAuthRequired's returned promise rejected (${phase}): ${truncateForLog(cause)}`);
              return throwError(() => config.errors.handler(signal.reason, cause));
            }),
            // D-14: the handler-resolved/now-waiting state, reachable on both the handler-present and
            // handler-absent paths (handled$ resolves to `of(undefined)` either way).
            tap(() =>
              phaseLine(`handler completed (${phase}) — now waiting for ${describeAuthRequirement(waitForAuth)}`),
            ),
            switchMap(() =>
              config.authSatisfied$(waitForAuth).pipe(
                filter((satisfied) => satisfied),
                take(1),
                // D-08: the join key an operation track hangs its "who satisfied this" line off — read
                // at the moment the wait resolves, not when the phase began.
                tap(() => {
                  const pubkeys = config.satisfiedPubkeys();
                  phaseLine(
                    pubkeys.length > 0
                      ? `wait satisfied (${phase}) — satisfied by ${pubkeys.join(",")}`
                      : `wait satisfied (${phase}) — no pubkeys reported`,
                  );
                }),
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
                  with: () => {
                    phaseLine(`${phase} timed out after ${authTimeout ?? 30_000}ms covering the handler and the wait`);
                    return throwError(() => config.errors.timeout(signal.reason));
                  },
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
        // D-08/CR-01: only a value config.isProgress accepts as real progress resets the consecutive
        // counter — a per-cycle budget, not a per-lifetime one. A call site's own bookkeeping value
        // (e.g. req()'s synthetic OPEN) must never reset it, or a persistently auth-gated relay could
        // drive an unbounded retry loop regardless of authRetries.
        tap((value) => {
          // D-07: the consecutive-counter reset intentionally emits no line of its own — the per-line
          // phase counter restarting at 1 on the next auth phase is what makes the reset observable.
          if (config.isProgress(value)) consecutive = 0;
        }),
      );
    });
}
