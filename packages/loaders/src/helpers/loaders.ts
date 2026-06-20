import {
  filter,
  identity,
  isObservable,
  map,
  mergeAll,
  MonoTypeOperatorFunction,
  Observable,
  OperatorFunction,
  share,
  Subject,
  switchMap,
  take,
  takeUntil,
} from "rxjs";

/** Takes a value optionally wrapped in an observable and unwraps it */
export function unwrap<T, R>(value: T | Observable<T>, next: (value: T) => Observable<R>): Observable<R> {
  return isObservable(value) ? value.pipe(take(1), switchMap(next)) : next(value);
}

/** A loader function that can be torn down via `stop()`, `Symbol.dispose`, or an `AbortSignal` */
export type Loader<Input, Output> = ((value: Input) => Observable<Output>) & {
  /** Tear down the loader's internal subscriptions and drop any in-flight upstream requests */
  stop(): void;
  [Symbol.dispose](): void;
};

export type BatchLoaderOptions = {
  /** An {@link AbortSignal} that tears down the loader when aborted */
  signal?: AbortSignal;
};

/**
 * Creates a loader that takes a single value and batches the requests to an upstream loader
 * IMPORTANT: the buffer operator MUST NOT filter values. its important that every input creates a new upstream request
 *
 * The batching engine is reference counted: the `buffer` (e.g. `bufferTime`) only runs while at least
 * one loader observable is subscribed and is torn down when the last one unsubscribes. This means the
 * loader cleans up after itself with no explicit shutdown required. `stop()`/`Symbol.dispose`/`signal`
 * are provided for deterministic, immediate teardown (e.g. dropping in-flight warm upstream requests).
 */
export function batchLoader<Input extends unknown = unknown, Output extends unknown = unknown>(
  buffer: OperatorFunction<Input, Input[]>,
  upstream: (input: Input[]) => Observable<Output>,
  matcher: (input: Input, output: Output) => boolean,
  output?: MonoTypeOperatorFunction<Output>,
  options?: BatchLoaderOptions,
): Loader<Input, Output> {
  const queue = new Subject<Input>();
  // Fires when the loader is torn down, completing the engine and dropping in-flight upstream requests
  const destroy = new Subject<void>();

  // Reference counted batching engine. `share()` subscribes to `queue.pipe(buffer)` (starting the
  // bufferTime timer) only while a loader observable is subscribed, and tears it down otherwise.
  const batches = queue.pipe(
    buffer,
    // If there is nothing in the buffer, dont make a request
    filter((b) => b.length > 0),
    // Every "buffer" make a new upstream request
    map((b) =>
      upstream(b).pipe(
        // Drop the in-flight upstream request when the loader is torn down
        takeUntil(destroy),
        // Never reset the upstream request so events keep loading into the store after unsubscribe
        share({ resetOnRefCountZero: false, resetOnComplete: false, resetOnError: false }),
      ),
    ),
    // Tear down the entire engine (and its bufferTime timer) on teardown
    takeUntil(destroy),
    // Reference count the engine so the bufferTime timer only runs while something is subscribed
    share(),
  );

  const loader = (input: Input) =>
    new Observable<Output>((observer) => {
      const sub = batches
        .pipe(
          // wait for the next batch to run
          take(1),
          // subscribe to it
          mergeAll(),
          // filter the results for the requested input
          filter((o) => matcher(input, o)),
          // Extra output operations
          output ?? identity,
        )
        .subscribe(observer);

      // Add the pointer to the queue once the engine is subscribed
      // NOTE: do not use setTimeout here, FF has a strange bug where it will delay the queue.next until after the buffer
      queue.next(input);

      return sub;
    });

  const stop = () => {
    destroy.next();
    destroy.complete();
    queue.complete();
  };

  // Tear down when the abort signal fires
  if (options?.signal) {
    if (options.signal.aborted) stop();
    else options.signal.addEventListener("abort", stop, { once: true });
  }

  return Object.assign(loader, { stop, [Symbol.dispose]: stop });
}
