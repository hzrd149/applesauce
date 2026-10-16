import { logger as baseLogger, type Debugger } from "applesauce-core";
import { defer, finalize, tap, type MonoTypeOperatorFunction, type SchedulerLike } from "rxjs";
import type { CountContext } from "../../loaders/count-sources/types.js";

const sourceLogger = baseLogger.extend("count-sources");

/** Resolves a source logger and derives each parent namespace only once */
export function createCountSourceLogger(name: string, supplied?: Debugger): (context: CountContext) => Debugger {
  const loggers = new WeakMap<Debugger, Debugger>();

  return (context) => {
    const parent = supplied ?? context.logger ?? sourceLogger;
    let log = loggers.get(parent);

    if (!log) {
      log = parent.extend(name);
      loggers.set(parent, log);
    }

    return log;
  };
}

/** Traces a finite operation without retaining history or subscribing separately */
export function traceCountOperation<T>(
  log: Debugger,
  clock: SchedulerLike,
  operation: string,
  details: Record<string, unknown>,
): MonoTypeOperatorFunction<T> {
  return (source) =>
    defer(() => {
      // Disabled logging adds no lifecycle operators or timing work to the transport.
      if (!log.enabled) return source;

      const began = clock.now();
      let received = false;
      let settled = false;
      log("%s started", operation, details);

      return source.pipe(
        tap({
          next: () => {
            received = true;
          },
          error: (error) => {
            settled = true;
            log("%s failed", operation, details, "elapsed", clock.now() - began, error);
          },
          complete: () => {
            settled = true;
            log("%s %s", operation, received ? "completed" : "empty", details, "elapsed", clock.now() - began);
          },
        }),

        finalize(() => {
          // take(1) unsubscribes after a reply; distinguish that from cancellation before any answer.
          if (!settled)
            log("%s %s", operation, received ? "answered" : "cancelled", details, "elapsed", clock.now() - began);
        }),
      );
    });
}
