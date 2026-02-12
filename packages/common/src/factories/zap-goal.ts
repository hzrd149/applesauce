import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { ZAP_GOAL_KIND } from "../helpers/zap-goal.js";
import * as ZapGoal from "../operations/zap-goal.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type ZapGoalTemplate = KnownEventTemplate<typeof ZAP_GOAL_KIND>;

export type ZapGoalBlueprintOptions = MetaTagOptions &
  ZapOptions & {
    closedAt?: number;
    image?: string;
    summary?: string;
  };

export class ZapGoalFactory extends EventFactory<typeof ZAP_GOAL_KIND, ZapGoalTemplate> {
  static create(description: string, amount: number, relays: string[]): ZapGoalFactory {
    return new ZapGoalFactory((res) => res(blankEventTemplate(ZAP_GOAL_KIND)))
      .content(description)
      .amount(amount)
      .relays(relays);
  }

  /** Sets the amount of the zap goal */
  amount(amount: number) {
    return this.chain(ZapGoal.setAmount(amount));
  }

  /** Sets the relays for the zap goal */
  relays(urls: string[]) {
    return this.chain(ZapGoal.setRelays(urls));
  }

  /** Sets the closed at timestamp for the zap goal */
  closedAt(timestamp: number) {
    return this.chain(ZapGoal.setClosedAt(timestamp));
  }

  /** Sets the image for the zap goal */
  image(url: string) {
    return this.chain(ZapGoal.setImage(url));
  }

  /** Sets the summary for the zap goal */
  summary(text: string) {
    return this.chain(ZapGoal.setSummary(text));
  }

  /** Sets the zap split for the zap goal */
  zapSplit(options: ZapOptions) {
    return this.chain(setZapSplit(options, undefined));
  }

  /** Sets the meta tags for the zap goal */
  meta(options: MetaTagOptions) {
    return this.chain(setMetaTags(options));
  }
}
