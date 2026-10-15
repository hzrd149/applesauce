import { mergeRelaySets } from "applesauce-core/helpers";

/** Takes an array of objects with a `relays` property and returns a map of relays to the objects */
export function groupByRelay<T extends { relays?: string[] }>(pointers: T[], extraRelays?: string[]): Map<string, T[]> {
  let byRelay = new Map<string, T[]>();
  for (const pointer of pointers) {
    let relays = mergeRelaySets(pointer.relays, extraRelays);
    for (const relay of relays) {
      if (!byRelay.has(relay)) byRelay.set(relay, [pointer]);
      else byRelay.get(relay)?.push(pointer);
    }
  }

  return byRelay;
}

/** Checks if a running pointer already loads everything a new pointer asks for (its relay hints and cache bypass) */
export function isPointerCovered<T extends { relays?: string[]; cache?: boolean }>(running: T, pointer: T): boolean {
  if (pointer.cache === false && running.cache !== false) return false;
  if (!pointer.relays?.length) return true;

  const relays = mergeRelaySets(running.relays);
  return mergeRelaySets(relays, pointer.relays).length === relays.length;
}

export interface MessageWithRelay {
  relays?: string[];
  /** Ignore timeout and force message through */
  force?: boolean;
  [key: string]: any;
}

/** Ensures that a message only is requested from each relay once in timeout */
export function removePreviouslyUsedRelays<T extends MessageWithRelay>(
  message: T,
  keyFn: (message: T) => string,
  cache: Map<string, number>,
  timeout = 60_000,
): T | null {
  if (message.force) return message;

  let key = keyFn(message);
  let now = Date.now();

  if (message.relays) {
    // requesting from specific relays
    let relays = message.relays;

    relays = relays.filter((relay) => {
      let relayKey = key + " " + relay;
      let last = cache.get(relayKey);
      if (!last || now >= last + timeout) {
        cache.set(relayKey, now);
        return true;
      } else return false;
    });

    if (relays.length === 0) return null;

    return { ...message, relays };
  } else {
    // requesting from default relays
    let last = cache.get(key);
    if (!last || now >= last + timeout) {
      cache.set(key, now);
      return message;
    } else return null;
  }
}
