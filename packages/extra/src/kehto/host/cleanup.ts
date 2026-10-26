/**
 * Runs every cleanup before reporting failures
 * @throws an AggregateError if any cleanup fails
 */
export function cleanupAll(cleanups: (() => void)[]) {
  const errors: unknown[] = [];
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "Kehto cleanup failed");
}
