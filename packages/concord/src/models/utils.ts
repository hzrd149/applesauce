import type { Rumor } from "applesauce-core/helpers/event";

import { ENCRYPTED_SEAL_KIND } from "../helpers/gift-wrap.js";
import { rumorMs } from "../helpers/stream.js";
import type { DecodedEvent } from "../types.js";

/** Convert a stored rumor into the decoded shape expected by Concord's folds. */
export function decodedFromRumor(rumor: Rumor, sealKind = ENCRYPTED_SEAL_KIND): DecodedEvent {
  return {
    rumor,
    author: rumor.pubkey,
    wrapId: rumor.id,
    sealKind,
    ms: rumorMs(rumor),
  };
}

export function observedAuthors(rumors: Iterable<Rumor>): Map<string, number> {
  const observed = new Map<string, number>();
  for (const rumor of rumors) {
    const ms = rumorMs(rumor);
    if (ms > (observed.get(rumor.pubkey) ?? 0)) observed.set(rumor.pubkey, ms);
  }
  return observed;
}

export function mergeObserved(maps: Iterable<Map<string, number>>): Map<string, number> {
  const merged = new Map<string, number>();
  for (const observed of maps) {
    for (const [pubkey, ms] of observed) if (ms > (merged.get(pubkey) ?? 0)) merged.set(pubkey, ms);
  }
  return merged;
}
