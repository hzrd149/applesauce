import { Observable, Subscriber, TimeoutError, type MonoTypeOperatorFunction } from "rxjs";

/**
 * Errors when a stream is idle without replacing its timer on every emission
 * @throws on subscription if milliseconds is non-finite or outside the native timer range
 */
export function idleTimeout<T>(milliseconds: number): MonoTypeOperatorFunction<T> {
  return (source) =>
    new Observable<T>((subscriber) => {
      if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 2_147_483_647) {
        throw new RangeError("Idle timeout must be between 0 and 2147483647 milliseconds");
      }

      let deadline = Date.now() + milliseconds;
      let timer: ReturnType<typeof setTimeout>;
      const check = () => {
        const remaining = deadline - Date.now();
        if (remaining <= 0) subscriber.error(new TimeoutError());
        else timer = setTimeout(check, remaining);
      };

      const upstream = new Subscriber<T>({
        next: (value) => {
          deadline = Date.now() + milliseconds;
          subscriber.next(value);
        },
        error: (error: unknown) => subscriber.error(error),
        complete: () => subscriber.complete(),
      });

      // Register cleanup before subscribing: sources may emit or terminate synchronously.
      subscriber.add(upstream);
      timer = setTimeout(check, milliseconds);
      subscriber.add(() => clearTimeout(timer));
      source.subscribe(upstream);
    });
}
