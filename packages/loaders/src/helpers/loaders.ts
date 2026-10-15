import {
  concat,
  defer,
  EMPTY,
  filter,
  finalize,
  from,
  identity,
  isObservable,
  mergeAll,
  MonoTypeOperatorFunction,
  Observable,
  OperatorFunction,
  share,
  Subject,
  switchMap,
  take,
  takeUntil,
  tap,
  timer,
} from "rxjs";

/** Takes a value optionally wrapped in an observable and unwraps it */
export function unwrap<T, R>(value: T | Observable<T>, next: (value: T) => Observable<R>): Observable<R> {
  return isObservable(value) ? value.pipe(take(1), switchMap(next)) : next(value);
}

/**
 * Requests targets again until a round resolves none of the remaining targets, since relays clamp results to their max_limit
 * @param load Creates the request for the remaining targets
 * @param targetKey Returns the key a target is resolved by
 * @param eventKey Returns the key an event resolves, or undefined if it resolves nothing
 * @param maxRounds The maximum number of requests to make ( default 5 )
 */
export function loadUntilSettled<Target, Output>(
  targets: Target[],
  load: (targets: Target[]) => Observable<Output>,
  targetKey: (target: Target) => string,
  eventKey: (output: Output) => string | undefined,
  maxRounds = 5,
): Observable<Output> {
  return defer(() => {
    // Keys resolved by any round
    const resolved = new Set<string>();

    const round = (remaining: Target[], count: number): Observable<Output> =>
      defer(() => {
        const earlier = new Set(resolved);

        const request = load(remaining).pipe(
          // Drop events a previous round already resolved, broad address filters can match them again
          filter((output) => {
            const key = eventKey(output);
            return key === undefined || !earlier.has(key);
          }),
          tap((output) => {
            const key = eventKey(output);
            if (key !== undefined) resolved.add(key);
          }),
        );

        // EOSE is not proof of absence, so request the missing targets again while each round makes progress
        const retry = defer(() => {
          const missing = remaining.filter((t) => !resolved.has(targetKey(t)));
          return count < maxRounds && missing.length > 0 && missing.length < remaining.length
            ? round(missing, count + 1)
            : EMPTY;
        });

        return concat(request, retry);
      });

    return round(targets, 1);
  });
}

/** Completes a loading stage after a timeout so unresolved pointers move on to the next stage */
export function withStageTimeout<Args extends unknown[], Output>(
  loader: ((...args: Args) => Observable<Output>) | undefined,
  timeout: number,
): ((...args: Args) => Observable<Output>) | undefined {
  if (!loader || !(timeout > 0)) return loader;
  return (...args) => loader(...args).pipe(takeUntil(timer(timeout)));
}

/** A loader function that can be torn down via `stop()`, `Symbol.dispose`, or an `AbortSignal` */
export type Loader<Input, Output> = ((value: Input) => Observable<Output>) & {
  /** Tear down the loader's internal subscriptions and drop any in-flight upstream requests */
  stop(): void;
  [Symbol.dispose](): void;
};

/** Options for sharing running requests with new inputs */
export type InflightOptions<Input> = {
  /** Returns the key identifying what an input loads */
  key: (input: Input) => string;
  /** Checks if a running input already loads everything a new input asks for */
  covers: (running: Input, input: Input) => boolean;
};

export type BatchLoaderOptions<Input = unknown> = {
  /** An {@link AbortSignal} that tears down the loader when aborted */
  signal?: AbortSignal;
  /** The maximum number of batches requesting upstream at once ( default Infinity ) */
  maxConcurrentBatches?: number;
  /** Lets new inputs join a queued or running batch that already covers them */
  inflight?: InflightOptions<Input>;
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
  options?: BatchLoaderOptions<Input>,
): Loader<Input, Output> {
  type Batch = { inputs: Input[]; results: Subject<Output> };
  type Running = { input: Input; batch: Batch; delivered: Output[] };

  const queue = new Subject<Input>();
  // Fires when the loader is torn down, completing the engine and dropping in-flight upstream requests
  const destroy = new Subject<void>();
  const maxConcurrent = options?.maxConcurrentBatches ?? Infinity;
  const inflight = options?.inflight;

  // Inputs whose batch is queued or running, so repeated inputs can join it instead of making another request
  const running = new Map<string, Running>();
  // Batches waiting for a free upstream slot
  const pending: Batch[] = [];
  let active = 0;
  let stopped = false;
  let draining = false;

  const track = (batch: Batch) => {
    if (!inflight) return;
    for (const input of batch.inputs) {
      const key = inflight.key(input);
      if (!running.has(key)) running.set(key, { input, batch, delivered: [] });
    }
  };
  const forget = (batch: Batch) => {
    if (!inflight) return;
    for (const [key, entry] of running) if (entry.batch === batch) running.delete(key);
  };
  const record = (batch: Batch, value: Output) => {
    if (!inflight) return;
    for (const entry of running.values())
      if (entry.batch === batch && matcher(entry.input, value)) entry.delivered.push(value);
  };

  const start = (batch: Batch) => {
    active++;

    // Run the output operator on a hot source, operators like filterDuplicateEvents subscribe to their source twice
    const source = new Subject<Output>();
    source
      .pipe(
        // Pass events through the store once per batch so they are saved even without consumers
        output ?? identity,
        tap({ next: (value) => record(batch, value), complete: () => forget(batch), error: () => forget(batch) }),
      )
      .subscribe(batch.results);

    // Not tied to the consumers, so the request keeps running after they unsubscribe until the loader stops
    defer(() => upstream(batch.inputs))
      .pipe(
        // Drop the in-flight upstream request when the loader is torn down
        takeUntil(destroy),
        finalize(() => {
          forget(batch);
          active--;
          drain();
        }),
      )
      .subscribe(source);
  };

  // Start queued batches while there are free slots
  const drain = () => {
    if (draining) return;
    draining = true;
    try {
      while (!stopped && active < maxConcurrent && pending.length > 0) {
        const batch = pending.shift()!;

        // Skip the request if every consumer for this batch already unsubscribed
        if (!batch.results.observed) {
          forget(batch);
          batch.results.complete();
        } else start(batch);
      }
    } finally {
      draining = false;
    }
  };

  // Reference counted batching engine. `share()` subscribes to `queue.pipe(buffer)` (starting the
  // bufferTime timer) only while a loader observable is subscribed, and tears it down otherwise.
  const batches = new Observable<Subject<Output>>((observer) =>
    queue
      .pipe(
        buffer,
        // If there is nothing in the buffer, dont make a request
        filter((b) => b.length > 0),
        // Tear down the entire engine (and its bufferTime timer) on teardown
        takeUntil(destroy),
      )
      .subscribe({
        next: (inputs) => {
          const batch: Batch = { inputs, results: new Subject<Output>() };
          track(batch);

          // Hand the batch to every waiting consumer before the request starts so synchronous results reach all of them
          observer.next(batch.results);

          pending.push(batch);
          drain();
        },
        error: (err) => observer.error(err),
        complete: () => observer.complete(),
      }),
  ).pipe(
    // Reference count the engine so the bufferTime timer only runs while something is subscribed
    share(),
  );

  const loader = (input: Input) =>
    new Observable<Output>((observer) => {
      // Join a queued or running batch that already covers this input
      const entry = inflight && running.get(inflight.key(input));
      if (entry && inflight.covers(entry.input, input)) {
        return concat(from([...entry.delivered]), entry.batch.results.pipe(filter((o) => matcher(input, o)))).subscribe(
          observer,
        );
      }

      const sub = batches
        .pipe(
          // wait for the next batch to run
          take(1),
          // subscribe to its results
          mergeAll(),
          // filter the results for the requested input
          filter((o) => matcher(input, o)),
        )
        .subscribe(observer);

      // Add the pointer to the queue once the engine is subscribed
      // NOTE: do not use setTimeout here, FF has a strange bug where it will delay the queue.next until after the buffer
      queue.next(input);

      return sub;
    });

  const stop = () => {
    if (stopped) return;
    stopped = true;
    const queued = pending.splice(0);
    destroy.next();
    destroy.complete();
    queue.complete();
    // Complete consumers waiting on batches that never started
    for (const batch of queued) batch.results.complete();
    running.clear();
  };

  // Tear down when the abort signal fires
  if (options?.signal) {
    if (options.signal.aborted) stop();
    else options.signal.addEventListener("abort", stop, { once: true });
  }

  return Object.assign(loader, { stop, [Symbol.dispose]: stop });
}
