import { EventOperation } from "applesauce-core/factories";
import { fillAndTrimTag } from "applesauce-core/helpers";
import { modifyPublicTags } from "applesauce-core/operations";
import { includeSingletonTag } from "applesauce-core/operations/tags";
import { setZapSplitTags } from "./zap-split.js";

/** Sets the target amount in milisats for a zap goal */
export function setAmount(amount: number): EventOperation {
  return includeSingletonTag(["amount", amount.toString()], true);
}

/** Sets the relay URLs for a zap goal */
export function setRelays(relays: string[]): EventOperation {
  return modifyPublicTags((tags) => {
    // Remove existing relays tags
    const filteredTags = tags.filter((tag) => tag[0] !== "relays");

    // Add new relays tags
    const relayTags = relays.map((url) => ["relays", url] as [string, string]);

    return [...filteredTags, ...relayTags];
  });
}

/** Sets the closed_at timestamp for a zap goal */
export function setClosedAt(timestamp: number): EventOperation {
  return includeSingletonTag(["closed_at", timestamp.toString()], true);
}

/** Sets the image URL for a zap goal */
export function setImage(url: string): EventOperation {
  return includeSingletonTag(["image", url], true);
}

/** Sets the summary for a zap goal */
export function setSummary(summary: string): EventOperation {
  return includeSingletonTag(["summary", summary], true);
}

/** Sets all beneficiaries for a zap goal using zap split tags */
export function setBeneficiaries(beneficiaries: Array<{ pubkey: string; weight: number }>): EventOperation {
  return setZapSplitTags(beneficiaries);
}

/** Sets a goal tag on an event (for linking events to goals) */
export function setGoalTag(goalId: string, relay?: string): EventOperation {
  return includeSingletonTag(fillAndTrimTag(["goal", goalId, relay]) as [string, ...string[]], true);
}
