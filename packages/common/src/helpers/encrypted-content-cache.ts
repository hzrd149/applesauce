import { logger } from "applesauce-core";
import { IEventStoreStreams } from "applesauce-core/event-store";
import {
  canHaveEncryptedContent,
  getEncryptedContent,
  isEncryptedContentUnlocked,
  setEncryptedContentCache,
} from "applesauce-core/helpers/encrypted-content";
import { kinds, NostrEvent, notifyEventUpdate } from "applesauce-core/helpers/event";
import {
  catchError,
  combineLatest,
  combineLatestWith,
  distinct,
  EMPTY,
  filter,
  isObservable,
  map,
  merge,
  mergeMap,
  Observable,
  of,
  switchMap,
} from "rxjs";
import { getGiftWrapSeal, getSealGiftWrap, getSealRumor, isGiftWrapUnlocked } from "./gift-wrap.js";

/** A symbol that is used to mark encrypted content as being from a cache */
export const EncryptedContentFromCacheSymbol = Symbol.for("encrypted-content-from-cache");

/** An interface that is used to cache encrypted content on events */
export interface EncryptedContentCache {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<any>;
}

/** Marks the encrypted content as being from a cache */
export function markEncryptedContentFromCache<T extends object>(event: T) {
  Reflect.set(event, EncryptedContentFromCacheSymbol, true);
}

/** Checks if the encrypted content is from a cache */
export function isEncryptedContentFromCache<T extends object>(event: T): boolean {
  return Reflect.has(event, EncryptedContentFromCacheSymbol);
}

const log = logger.extend("EncryptedContentCache");

/**
 * Starts a process that persists and restores all encrypted content
 * @param eventStore - The event store to listen to
 * @param storage - The storage to use
 * @param fallback - A function that will be called when the encrypted content is not found in storage
 * @returns A function that can be used to stop the process
 */
export function persistEncryptedContent(
  eventStore: IEventStoreStreams,
  storage: EncryptedContentCache | Observable<EncryptedContentCache>,
  fallback?: (event: NostrEvent) => any | Promise<any>,
): () => void {
  const storage$ = isObservable(storage) ? storage : of(storage);

  // Get the encrypted content from storage or call the fallback
  const getItem = async (storage: EncryptedContentCache, event: NostrEvent) => {
    return (await storage.getItem(event.id)) || (fallback ? await fallback(event) : null);
  };

  // Restore encrypted content when it is inserted
  const restore = eventStore.insert$
    .pipe(
      // Look for events that support encrypted content and are locked
      filter((e) => canHaveEncryptedContent(e.kind) && isEncryptedContentUnlocked(e) === false),
      // Get the storage
      combineLatestWith(storage$),
      // Get the encrypted content from storage
      mergeMap(([event, storage]) =>
        // Get content from storage
        combineLatest([
          of(event),
          getItem(storage, event).catch((error) => {
            log(`Failed to restore encrypted content for ${event.id}`, error);
            return of(null);
          }),
        ]),
      ),
    )
    .subscribe(async ([event, content]) => {
      if (typeof content !== "string") return;

      // Restore the encrypted content and set it as from a cache
      markEncryptedContentFromCache(event);
      setEncryptedContentCache(event, content);

      log(`Restored encrypted content for ${event.id}`);
    });

  // Restore seals when they are unlocked
  const restoreSeals = eventStore.update$
    .pipe(
      // Look for gift wraps that are unlocked
      filter((e) => e.kind === kinds.GiftWrap && isEncryptedContentUnlocked(e)),
      // Get the seal event
      map((gift) => getGiftWrapSeal(gift)),
      // Look for gift wraps with locked seals
      filter((seal) => seal !== undefined && isEncryptedContentUnlocked(seal) === false),
      // Only attempt to unlock seals once
      distinct((seal) => seal!.id),
      // Get encrypted content from storage
      mergeMap((seal) =>
        // Wait for storage to be available
        storage$.pipe(
          switchMap((storage) => combineLatest([of(seal), getItem(storage, seal!)])),
          catchError((error) => {
            log(`Failed to restore encrypted content for ${seal!.id}`, error);
            return EMPTY;
          }),
        ),
      ),
    )
    .subscribe(async ([seal, content]) => {
      if (!seal || !content) return;

      markEncryptedContentFromCache(seal);
      setEncryptedContentCache(seal, content);

      // Parse the rumor event
      getSealRumor(seal);

      // Trigger an update to the gift wrap event
      const gift = getSealGiftWrap(seal);
      if (gift) notifyEventUpdate(gift);

      log(`Restored encrypted content for ${seal.id}`);
    });

  // Persist encrypted content when it is updated or inserted
  const persist = merge(eventStore.update$, eventStore.insert$)
    .pipe(
      // Look for events that support encrypted content and are unlocked and not from the cache
      filter(
        (event) =>
          canHaveEncryptedContent(event.kind) &&
          isEncryptedContentUnlocked(event) &&
          isEncryptedContentFromCache(event) === false,
      ),
      // Only persist the encrypted content once
      distinct((event) => event.id),
      // get the storage
      combineLatestWith(storage$),
    )
    .subscribe(async ([event, storage]) => {
      try {
        const content = getEncryptedContent(event);
        if (content) {
          await storage.setItem(event.id, content);
          log(`Persisted encrypted content for ${event.id}`);
        }
      } catch (error) {
        // Ignore errors when saving encrypted content
        log(`Failed to persist encrypted content for ${event.id}`, error);
      }
    });

  // Persist seals when the gift warp is unlocked or inserted unlocked
  // This relies on the gift wrap event being updated when a seal is unlocked
  const unlockedSeals$ = merge(eventStore.update$, eventStore.insert$).pipe(
    filter((event) => event.kind === kinds.GiftWrap),
    filter(isGiftWrapUnlocked),
    map((gift) => getGiftWrapSeal(gift)),
    distinct((seal) => seal.id),
  );
  const persistSeals = unlockedSeals$
    .pipe(
      filter((seal) => isEncryptedContentFromCache(seal) === false),
      combineLatestWith(storage$),
    )
    .subscribe(async ([seal, storage]) => {
      if (!seal) return;
      try {
        const content = getEncryptedContent(seal);
        if (content) {
          await storage.setItem(seal.id, content);
          log(`Persisted encrypted content for ${seal.id}`);
        }
      } catch (error) {
        // Ignore errors when saving encrypted content
        log(`Failed to persist encrypted content for ${seal.id}`, error);
      }
    });

  return () => {
    restore.unsubscribe();
    persist.unsubscribe();
    restoreSeals.unsubscribe();
    persistSeals.unsubscribe();
  };
}
