import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { isKind, kinds, KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { NIP51UserListFactory } from "./list.js";

export type FollowSetTemplate = KnownEventTemplate<kinds.Followsets>;

/** A factory class for building kind 30000 follow set events */
export class FollowSetFactory extends NIP51UserListFactory<kinds.Followsets, FollowSetTemplate> {
  /** Creates a new follow set factory */
  static create(): FollowSetFactory {
    return new FollowSetFactory((res) => res(blankEventTemplate(kinds.Followsets)));
  }

  /** Creates a new follow set factory from an existing follow set event */
  static modify(event: NostrEvent | KnownEvent<kinds.Followsets>): FollowSetFactory {
    if (!isKind(event, kinds.Followsets)) throw new Error("Event is not a follow set event");
    return new FollowSetFactory((res) => res(toEventTemplate(event)));
  }
}
