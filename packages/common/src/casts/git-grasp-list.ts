import { NostrEvent } from "applesauce-core/helpers/event";
import { getGitGraspServers, GitGraspListEvent, isValidGitGraspList } from "../helpers/git-grasp-list.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast for NIP-34 user grasp server lists. */
export class GitGraspList extends EventCast<GitGraspListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitGraspList(event)) throw new Error("Invalid git grasp list event");
    super(event, store);
  }

  get servers() {
    return getGitGraspServers(this.event);
  }
}
