import { NostrEvent } from "applesauce-core/helpers";
import { combineLatest, map, of } from "rxjs";
import {
  getZapGoalAmount,
  getZapGoalBeneficiaries,
  getZapGoalClosedAt,
  getZapGoalImage,
  getZapGoalProgress,
  getZapGoalRelays,
  getZapGoalSummary,
  isValidZapGoal,
  ZapGoalEvent,
  ZapGoalProgress,
} from "../helpers/zap-goal.js";
import { EventZapsModel } from "../models/zaps.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast a kind 9041 event to a ZapGoal */
export class ZapGoal extends EventCast<ZapGoalEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidZapGoal(event)) throw new Error("Invalid zap goal");
    super(event, store);
  }

  get amount() {
    return getZapGoalAmount(this.event);
  }
  get relays() {
    return getZapGoalRelays(this.event);
  }
  get closedAt() {
    return getZapGoalClosedAt(this.event);
  }
  get image() {
    return getZapGoalImage(this.event);
  }
  get summary() {
    return getZapGoalSummary(this.event);
  }
  get beneficiaries() {
    return getZapGoalBeneficiaries(this.event);
  }
  get description() {
    return this.event.content;
  }

  /** An observable of all zaps contributing to this goal */
  get zaps$() {
    return this.$$ref("zaps$", (store) => {
      return store.model(EventZapsModel, this.event);
    });
  }

  /** An observable of the goal progress */
  get progress$() {
    return this.$$ref("progress$", (_store) => {
      return combineLatest([of(this.event), this.zaps$]).pipe(
        map(([goal, zaps]): ZapGoalProgress | undefined => {
          return getZapGoalProgress(goal, zaps);
        }),
      );
    });
  }
}
