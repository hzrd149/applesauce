import { NostrEvent } from "./event.js";
import { IEventStoreStreams } from "../event-store/interface.js";
import { bufferTime, filter } from "rxjs";
import { logger } from "../logger.js";
import { isFromCache } from "./event.js";

const log = logger.extend("event-cache");

/**
 * Setups a process to write batches of new events from an event store to a cache
 * @param eventStore - The event store to read from
 * @param write - The function to write the events to the cache
 * @param opts - The options for the process
 * @param opts.batchTime - The time to wait before writing a batch (default: 5 seconds)
 * @param opts.maxBatchSize - The maximum number of events to write in a batch
 * @returns A function to stop the process
 */
export function persistEventsToCache(
  eventStore: IEventStoreStreams,
  write: (events: NostrEvent[]) => Promise<void>,
  opts?: { maxBatchSize?: number; batchTime?: number },
): () => void {
  const time = opts?.batchTime ?? 5_000;

  // Save all new events to the cache
  const sub = eventStore.insert$
    .pipe(
      // Only select events that are not from the cache
      filter((e) => !isFromCache(e)),
      // Buffer events for 5 seconds
      opts?.maxBatchSize ? bufferTime(time, undefined, opts?.maxBatchSize ?? 100) : bufferTime(time),
      // Only select buffers with events
      filter((b) => b.length > 0),
    )
    .subscribe((events) => {
      // Save all new events to the cache
      write(events)
        .then(() => log(`Saved ${events.length} events to cache`))
        .catch((e) => log(`Failed to save ${events.length} events to cache`, e));
    });

  return () => sub.unsubscribe();
}

/** @deprecated Use persistEventsToCache instead */
export const presistEventsToCache = persistEventsToCache;
