/**
 * Resolves multiple promises concurrently, similar to RxJS combineLatest but for async operations.
 * Each promise races against the provided timeout. If a promise doesn't resolve within the timeout,
 * its value will be `undefined` in the returned object.
 *
 * @param map - An object where each value is a Promise
 * @param timeout - Global timeout in milliseconds for all fields. If a field doesn't resolve within this time, it will be `undefined`
 * @returns A promise that resolves to an object with the same keys, where each value is either the resolved value or `undefined`
 *
 * @example
 * ```ts
 * const { profile, mailboxes, notes } = await loadAsyncMap(
 *   {
 *     profile: user.profile$.$first(),
 *     mailboxes: user.mailboxes$.$first(1000),
 *     notes: lastValueFrom(someObservable),
 *   },
 *   30 * 1000, // 30 second timeout
 * );
 * ```
 */
export async function loadAsyncMap<T extends Record<string, Promise<any>>>(
  map: T,
  timeout: number,
): Promise<{ [K in keyof T]: Awaited<T[K]> | undefined }> {
  // Race each promise against the timeout
  // If the promise resolves first, use its value
  // If the timeout happens first, use undefined
  // If the promise rejects, catch it and return undefined
  const entries = Object.entries(map) as Array<[keyof T, Promise<any>]>;
  if (entries.length === 0) return {} as { [K in keyof T]: Awaited<T[K]> | undefined };

  let timer: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<{ type: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ type: "timeout" }), timeout);
  });

  const results = await Promise.allSettled(
    entries.map(async ([key, promise]): Promise<[keyof T, Awaited<T[typeof key]> | undefined]> => {
      // Wrap promise to handle rejections gracefully and prevent unhandled rejections
      const safePromise = promise
        .then((value) => ({ type: "resolved" as const, value }))
        .catch(() => ({ type: "rejected" as const }));

      const result = await Promise.race([safePromise, timeoutPromise]);

      if (result.type === "timeout" || result.type === "rejected") {
        return [key, undefined];
      } else {
        return [key, result.value as Awaited<T[typeof key]>];
      }
    }),
  ).finally(() => clearTimeout(timer));

  // Extract values from settled results, defaulting to undefined if anything went wrong
  const extractedResults = results.map((settled, index) => {
    if (settled.status === "fulfilled") {
      return settled.value;
    } else {
      // If the outer promise somehow rejected, return undefined for that key
      const key = entries[index][0];
      return [key, undefined] as [keyof T, Awaited<T[typeof key]> | undefined];
    }
  });

  // Reconstruct the object with the same keys
  return Object.fromEntries(extractedResults) as { [K in keyof T]: Awaited<T[K]> | undefined };
}
