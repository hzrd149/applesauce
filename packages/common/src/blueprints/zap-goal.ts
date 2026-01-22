import { blueprint, EventBlueprint } from "applesauce-core/event-factory";
import { MetaTagOptions, setContent, setMetaTags } from "applesauce-core/operations";
import { ZAP_GOAL_KIND } from "../helpers/zap-goal.js";
import * as ZapGoal from "../operations/zap-goal.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type ZapGoalBlueprintOptions = MetaTagOptions &
  ZapOptions & {
    /** Unix timestamp when the goal closes */
    closedAt?: number;
    /** Image URL for the goal */
    image?: string;
    /** Brief summary of the goal */
    summary?: string;
  };

/**
 * NIP-75 Zap Goal event (kind 9041) blueprint
 * Creates a zap goal event with description, target amount, and relays
 */
export function ZapGoalBlueprint(
  description: string,
  amount: number,
  relays: string[],
  opts?: ZapGoalBlueprintOptions,
): EventBlueprint {
  return blueprint(
    ZAP_GOAL_KIND,
    setContent(description),
    ZapGoal.setAmount(amount),
    ZapGoal.setRelays(relays),
    opts?.closedAt ? ZapGoal.setClosedAt(opts.closedAt) : undefined,
    opts?.image ? ZapGoal.setImage(opts.image) : undefined,
    opts?.summary ? ZapGoal.setSummary(opts.summary) : undefined,
    setZapSplit(opts),
    setMetaTags({ ...opts, alt: opts?.alt ?? `Zap Goal: ${opts?.summary || description}` }),
  );
}
