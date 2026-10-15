import {
  concatMap,
  EMPTY,
  isObservable,
  mergeMap,
  mergeWith,
  NEVER,
  Observable,
  OperatorFunction,
  share,
  Subscription,
  switchMap,
} from "rxjs";

/** Creates an observable that runs a generator and flattes the results */
export function fromGenerator<Result>(
  generator:
    | Generator<Observable<Result> | Result, void, Result[]>
    | AsyncGenerator<Observable<Result> | Result, void, Result[]>,
): Observable<Result> {
  return new Observable<Result>((observer) => {
    // Track every stage, a synchronous stage can complete into the next one before its own subscribe() returns
    const subs = new Subscription();

    const nextSequence = (prevResults?: Result[]) => {
      // Dont start another stage after teardown
      if (subs.closed) return;

      const p = prevResults ? generator.next(prevResults) : generator.next();

      const handleResult = (result: IteratorResult<Observable<Result> | Result>) => {
        // Ignore stages resolved after teardown
        if (subs.closed) return;

        // generator complete, exit
        if (result.done) {
          // Ignore result.value here because its the return value and we only want the yield values
          return observer.complete();
        }

        const results: Result[] = [];
        if (isObservable(result.value)) {
          subs.add(
            result.value.subscribe({
              next: (v) => {
                // track results and pass along values
                results.push(v);
                observer.next(v);
              },
              error: (err) => {
                observer.error(err);
              },
              complete: () => {
                // run next step
                nextSequence(results);
              },
            }),
          );
        } else {
          results.push(result.value);
          observer.next(result.value);
          nextSequence(results);
        }
      };

      // if its an async generator, wait for the promise
      if (p instanceof Promise) p.then(handleResult, (err) => observer.error(err));
      else handleResult(p);
    };

    // start running steps
    nextSequence();

    // Tear down the active stage and let the generator run its finally blocks
    subs.add(() => {
      try {
        const done = generator.return(undefined);
        if (done instanceof Promise) done.catch(() => {});
      } catch {
        // The generator is still executing, it will stop at the closed check
      }
    });
    return subs;
  }).pipe(
    // Only create a single instance of the observalbe to avoice race conditions
    share(),
  );
}

/** Wraps a generator function to return an observable */
export function wrapGeneratorFunction<Args extends unknown[], Result>(
  constructor: (
    ...args: Args
  ) =>
    | Generator<Observable<Result> | Result, void, Result[]>
    | AsyncGenerator<Observable<Result> | Result, void, Result[]>,
): (...args: Args) => Observable<Result> {
  return (...args: Args) => fromGenerator(constructor(...args));
}

/** Runs a generator for each value in sequence waiting for each to complete before running the next */
export function concatGeneratorMap<Input, Result>(
  createGenerator: (
    value: Input,
  ) =>
    | Generator<Observable<Result> | Result, void, Result[]>
    | AsyncGenerator<Observable<Result> | Result, void, Result[]>,
): OperatorFunction<Input, Result> {
  return (source) => source.pipe(concatMap((value) => fromGenerator(createGenerator(value))));
}

/** Runs a generator for each value, canceling the current generator if a new value is received */
export function switchGeneratorMap<Input, Result>(
  createGenerator: (
    value: Input,
  ) =>
    | Generator<Observable<Result> | Result, void, Result[]>
    | AsyncGenerator<Observable<Result> | Result, void, Result[]>,
): OperatorFunction<Input, Result> {
  return (source) => source.pipe(switchMap((value) => fromGenerator(createGenerator(value))));
}

/** Keeps retrying a value until the generator returns */
export function generator<Input, Result>(
  createGenerator: (
    value: Input,
  ) =>
    | Generator<Observable<Result> | Result, void, Result[]>
    | AsyncGenerator<Observable<Result> | Result, void, Result[]>,
  /** @deprecated merge with NEVER if no completion is needed */
  shouldComplete = true,
): OperatorFunction<Input, Result> {
  return (source) =>
    source.pipe(
      // Run the generator for each value
      mergeMap((value) => fromGenerator(createGenerator(value))),
      // Merge with NEVER if shouldComplete is false
      mergeWith(shouldComplete ? EMPTY : NEVER),
    );
}
