import {
  BehaviorSubject,
  catchError,
  defer,
  distinctUntilChanged,
  endWith,
  filter,
  finalize,
  from,
  identity,
  ignoreElements,
  map,
  MonoTypeOperatorFunction,
  Observable,
  of,
  retry,
  switchMap,
  take,
  tap,
  throwError,
  timeout,
  TimeoutError,
} from "rxjs";

import { describeAuthRequirement, describeWireRequest, truncateForLog } from "../helpers/auth-log.js";
import type { AuthRequirement, RelayAuthContext, RelayAuthHandler } from "../types.js";

/**
 * Internal-only D-04 operator. NOT barrel-exported from `operators/index.ts` (mirrors `complete-when.ts`'s
 * precedent) — its exports are the shared auth-retry operator and the operation-clock gate, which
 * would become maintained public API for no consumer benefit. Must NOT import from `../relay.js`; `Relay`
 * injects its error constructors so the value-level dependency stays one-way (relay.ts -> this module).
 */

/** Errors an authRetry produced itself when giving up, so a stacked authRetry never runs a second phase on them */
const terminalErrors = new WeakSet<object>();

/** Records an error as terminal and returns it unchanged */
function markTerminal(error: unknown): unknown {
  if (typeof error === "object" && error !== null) terminalErrors.add(error);
  return error;
}

/** Checks whether an authRetry already gave up with this error */
function isTerminal(error: unknown): boolean {
  return typeof error === "object" && error !== null && terminalErrors.has(error);
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
 * Module-level symbol under which `request` hands its {@link AuthPhaseGate}
 * to the inner `req` operation it drives, without the gate ever appearing in any
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

/**
 * Bounds the complete source lifetime while pausing elapsed-time accounting during
 * call-scoped authentication. Unlike {@link suspendableTimeout}, next values never
 * disarm or reset this clock.
 */
export function authSuspendableLifetime<T>(budgetMs: number, gate: AuthPhaseGate): MonoTypeOperatorFunction<T> {
  if (!Number.isFinite(budgetMs) || budgetMs <= 0) return identity;

  return (source) =>
    new Observable<T>((subscriber) => {
      let remaining = budgetMs;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let armedAt: number | null = null;
      let settled = false;

      const clearTimer = () => {
        if (timer !== null) clearTimeout(timer);
        timer = null;
      };
      const disarm = () => {
        if (armedAt !== null) remaining = Math.max(0, remaining - (Date.now() - armedAt));
        armedAt = null;
        clearTimer();
      };
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimer();
        gateSub.unsubscribe();
        sourceSub.unsubscribe();
        subscriber.error(new TimeoutError());
      };
      const arm = () => {
        if (settled || timer !== null) return;
        armedAt = Date.now();
        timer = setTimeout(fail, remaining);
      };

      const gateSub = gate.active$.subscribe((active) => (active ? disarm() : arm()));
      const sourceSub = source.subscribe({
        next: (value) => subscriber.next(value),
        error: (error) => {
          if (settled) return;
          settled = true;
          clearTimer();
          subscriber.error(error);
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
  /** Optional call-scoped counter shared across outer retry resubscriptions. */
  counter?: { consecutive: number };
  /** What auth state to wait for. `false` terminates immediately without invoking the handler (RAUTH-06) */
  waitForAuth?: AuthRequirement;
  /** Invoked once per auth phase, even when `waitForAuth` is already satisfied (D-11) */
  onAuthRequired?: RelayAuthHandler;
  /** Per-phase timeout in ms, or `false` for unbounded. Defaults to 30_000 (D-12/D-13/D-14) */
  authTimeout?: number | false;
  /** Consecutive auth-failure cycles tolerated before giving up. Defaults to 1 (D-03/D-07/RAUTH-03) */
  authRetries?: number;
  /**
   * Required (CR-01): answers whether a stream value represents progress from the
   * relay, as opposed to a call site's own bookkeeping value. Gates the D-08 consecutive-counter reset
   * — a value this rejects does not reset the retry budget, so a call site's bookkeeping emission (e.g.
   * `req()`'s synthetic `OPEN`) can never mask a persistently auth-gated relay.
   */
  isProgress: ProgressPredicate<T>;
  /** Returns the relay's refusal reason when an error means auth is required, or undefined for any other error */
  authRequiredReason: (error: unknown) => string | undefined;
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
 * D-04 shared operator. Runs an auth phase whenever the source errors with auth-required, then resubscribes the source
 * once that phase resolves, while every other error passes straight through.
 */
export function authRetry<T>(config: AuthRetryConfig<T>): MonoTypeOperatorFunction<T> {
  const waitForAuth = config.waitForAuth ?? true;
  const authRetries = config.authRetries ?? 1;

  return (source: Observable<T>) =>
    defer(() => {
      // Consecutive auth-failure counter. Lives in this per-subscription closure only — no relay-scoped
      // state — so concurrent operations never share or dedupe an auth outcome (RAUTH-05).
      let consecutive = config.counter?.consecutive ?? 0;
      const setConsecutive = (value: number) => {
        consecutive = value;
        if (config.counter) config.counter.consecutive = value;
      };

      const runPhase = (reason: string): Observable<boolean> => {
        // D-05: hoisted above both early returns so even a short-circuit path (opted out, retries
        // exhausted) still has a request label to log — buildContext is a pure assembly with no
        // side effects, so moving it earlier is safe.
        const context = config.buildContext(reason);
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
          return throwError(() => markTerminal(config.errors.exhausted(reason)));
        }

        // D-03/D-07: retries exhausted, terminal
        if (consecutive >= authRetries) {
          phaseLine(`auth retry budget of ${authRetries} phase(s) is exhausted — giving up`);
          return throwError(() => markTerminal(config.errors.exhausted(reason)));
        }

        setConsecutive(consecutive + 1);
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
            return throwError(() => markTerminal(config.errors.handler(reason, cause)));
          }
          const handled$ = result instanceof Promise ? from(result) : of(undefined);

          return handled$.pipe(
            catchError((cause) => {
              phaseLine(`onAuthRequired's returned promise rejected (${phase}): ${truncateForLog(cause)}`);
              return throwError(() => markTerminal(config.errors.handler(reason, cause)));
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
                    return throwError(() => markTerminal(config.errors.timeout(reason)));
                  },
                }),
              );

        // Emit once the phase resolves, since a retry notifier that completes without emitting would end the stream
        return timed$.pipe(ignoreElements(), endWith(true));
      };

      return source.pipe(
        // D-08/CR-01: only a value config.isProgress accepts as real progress resets the consecutive
        // counter — a per-cycle budget, not a per-lifetime one. A call site's own bookkeeping value
        // (e.g. req()'s synthetic OPEN) must never reset it, or a persistently auth-gated relay could
        // drive an unbounded retry loop regardless of authRetries.
        tap((value) => {
          // D-07: the consecutive-counter reset intentionally emits no line of its own — the per-line
          // phase counter restarting at 1 on the next auth phase is what makes the reset observable.
          if (config.isProgress(value)) setConsecutive(0);
        }),
        // D-10: run an auth phase when the relay refuses, then resubscribe immediately once it resolves. The error has
        // already reset every share() on its path, so the resubscribe cannot rejoin the refused attempt (CR-02/CR-03)
        retry({
          delay: (error) => {
            // Never run a second phase on an error that an authRetry already gave up with
            if (isTerminal(error)) return throwError(() => error);
            const reason = config.authRequiredReason(error);
            return reason === undefined ? throwError(() => error) : runPhase(reason);
          },
        }),
      );
    });
}
