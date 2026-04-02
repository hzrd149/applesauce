import { EventOperation } from "applesauce-core/factories";
import { skip } from "applesauce-core/helpers/pipeline";
import { fillAndTrimTag } from "applesauce-core/helpers/tags";
import { ZapSplit } from "../helpers/zap.js";

/**
 * Override the zap splits on an event
 * @param splits - Array of zap splits
 * @param getRelayHint - Optional function to get relay hint for pubkey
 */
export function setZapSplitTags(
  splits: Omit<ZapSplit, "percent" | "relay">[],
  getRelayHint?: (pubkey: string) => Promise<string | undefined>,
): EventOperation {
  return async (draft) => {
    let tags = Array.from(draft.tags);

    // remove any existing zap split tags
    tags = tags.filter((t) => t[0] !== "zap");

    // add split tags
    for (const split of splits) {
      const hint = getRelayHint ? await getRelayHint(split.pubkey) : undefined;
      tags.push(fillAndTrimTag(["zap", split.pubkey, hint, String(split.weight)]));
    }

    return { ...draft, tags };
  };
}

/** Options for {@link setZapSplit} */
export type ZapOptions = {
  splits?: Omit<ZapSplit, "percent" | "relay">[];
};

/** Creates the necessary operations for zap options */
export function setZapSplit(
  options?: ZapOptions,
  getRelayHint?: (pubkey: string) => Promise<string | undefined>,
): EventOperation {
  return options?.splits ? setZapSplitTags(options.splits, getRelayHint) : skip();
}
