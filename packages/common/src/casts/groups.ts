import { hasHiddenContent, HiddenContentSigner } from "applesauce-core/helpers";
import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { watchEventUpdates } from "applesauce-core/observable";
import { map, of } from "rxjs";
import {
  getHiddenGroups,
  getPublicGroups,
  GROUPS_LIST_KIND,
  isHiddenGroupsUnlocked,
  unlockHiddenGroups,
} from "../helpers/groups.js";
import { CastRefEventStore, EventCast } from "./cast.js";

function isValidGroupsList(event: NostrEvent): event is KnownEvent<typeof GROUPS_LIST_KIND> {
  return event.kind === GROUPS_LIST_KIND;
}

export class GroupsList extends EventCast<KnownEvent<typeof GROUPS_LIST_KIND>> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGroupsList(event)) throw new Error("Invalid groups list");
    super(event, store);
  }

  /** The public groups in the list */
  get groups() {
    return getPublicGroups(this.event);
  }

  /** Get the unlocked hidden groups */
  get hidden() {
    return getHiddenGroups(this.event);
  }
  /** An observable that updates when hidden groups are unlocked */
  get hidden$() {
    return this.$$ref("hidden$", (store) =>
      of(this.event).pipe(
        // Watch for event updates
        watchEventUpdates(store),
        // Get hidden groups
        map((event) => event && getHiddenGroups(event)),
      ),
    );
  }

  /** Whether the groups list has hidden groups */
  get hasHidden() {
    return hasHiddenContent(this.event);
  }
  /** Whether the groups list is unlocked */
  get unlocked() {
    return isHiddenGroupsUnlocked(this.event);
  }
  /** Unlocks the hidden groups on the groups list */
  async unlock(signer: HiddenContentSigner) {
    return unlockHiddenGroups(this.event, signer);
  }
}
