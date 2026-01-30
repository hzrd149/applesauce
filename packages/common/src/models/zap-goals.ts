import { Model } from "applesauce-core/event-store";
import { EventPointer, NostrEvent } from "applesauce-core/helpers";
import { combineLatest, map } from "rxjs";
import {
  ZAP_GOAL_KIND,
  ZapGoalEvent,
  ZapGoalProgress,
  getZapGoalProgress,
  isValidZapGoal,
} from "../helpers/zap-goal.js";
import { EventZapsModel } from "./zaps.js";

/** A model that returns all zap goals created by a user */
export function UserGoalsModel(pubkey: string): Model<ZapGoalEvent[]> {
  return (events) =>
    events
      .timeline([{ kinds: [ZAP_GOAL_KIND], authors: [pubkey] }])
      .pipe(map((events) => events.filter(isValidZapGoal)));
}

/** A model that returns all zaps for a specific goal */
export function GoalZapsModel(goal: NostrEvent | EventPointer | string): Model<NostrEvent[]> {
  return (events) => {
    const goalId = typeof goal === "string" ? goal : goal.id;
    return events.model(EventZapsModel, goalId);
  };
}

/** A model that returns calculated progress for a goal */
export function GoalProgressModel(goal: NostrEvent | EventPointer | string): Model<ZapGoalProgress | undefined> {
  return (events) => {
    const goalEvent$ = events.event(goal);
    const zaps$ = events.model(GoalZapsModel, goal);

    return combineLatest([goalEvent$, zaps$]).pipe(
      map(([goalEvent, zaps]) => {
        if (!goalEvent) return undefined;
        return getZapGoalProgress(goalEvent, zaps);
      }),
    );
  };
}
