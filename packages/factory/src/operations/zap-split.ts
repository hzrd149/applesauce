import { ZapSplit } from "applesauce-common/helpers/zap";

import { skip } from "../helpers/pipeline.js";
import { fillAndTrimTag } from "../helpers/tag.js";
import { EventOperation } from "../types.js";

/** Override the zap splits on an event */
export function setZapSplitTags(splits: Omit<ZapSplit, "percent" | "relay">[]): EventOperation {
  return async (draft, ctx) => {
    let tags = Array.from(draft.tags);

    // remove any existing zap split tags
    tags = tags.filter((t) => t[0] !== "zap");

    // add split tags
    for (const split of splits) {
      const hint = await ctx.getPubkeyRelayHint?.(split.pubkey);
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
export function setZapSplit(options?: ZapOptions): EventOperation {
  return options?.splits ? setZapSplitTags(options.splits) : skip();
}
