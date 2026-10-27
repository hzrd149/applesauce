import { catchError, defer, map, mergeMap, MonoTypeOperatorFunction, of } from "rxjs";
import { EncryptedContentCache, restoreEncryptedContent } from "../helpers/encrypted-content-cache.js";
import { canHaveEncryptedContent, isEncryptedContentUnlocked } from "../helpers/encrypted-content.js";
import { NostrEvent } from "../helpers/event.js";
import { logger } from "../logger.js";

const log = logger.extend("restoreEncryptedContentFromCache");

/**
 * Restores cached plaintext before emitting each event, logging cache failures and continuing
 * @param concurrency The maximum number of concurrent cache lookups, defaulting to eight
 * @note Events may be emitted out of order; use a concurrency of one to preserve order
 * @throws If concurrency is not a positive integer
 */
export function restoreEncryptedContentFromCache<T extends NostrEvent>(
  storage: EncryptedContentCache,
  concurrency = 8,
): MonoTypeOperatorFunction<T> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Concurrency must be a positive integer");
  }

  return mergeMap((event: T) => {
    if (!canHaveEncryptedContent(event.kind) || isEncryptedContentUnlocked(event)) return of(event);

    return defer(() => restoreEncryptedContent(event, storage)).pipe(
      map(() => event),
      // A failed lookup must not drop the event or terminate the surrounding stream.
      catchError((error) => {
        log(`Failed to restore encrypted content for ${event.id}`, error);
        return of(event);
      }),
    );
  }, concurrency);
}
