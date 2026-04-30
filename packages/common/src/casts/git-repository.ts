import { getAddressPointerForEvent } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  getGitRepositoryCloneUrls,
  getGitRepositoryDescription,
  getGitRepositoryEarliestUniqueCommit,
  getGitRepositoryHashtags,
  getGitRepositoryIdentifier,
  getGitRepositoryMaintainers,
  getGitRepositoryName,
  getGitRepositoryRelays,
  getGitRepositoryWebUrls,
  GitRepositoryEvent,
  GitRepositoryPointer,
  isGitRepositoryPersonalFork,
  isValidGitRepository,
} from "../helpers/git-repository.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Cast for NIP-34 repository announcement events. */
export class GitRepository extends EventCast<GitRepositoryEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitRepository(event)) throw new Error("Invalid git repository announcement event");
    super(event, store);
  }

  get identifier() {
    return getGitRepositoryIdentifier(this.event)!;
  }

  get pointer(): GitRepositoryPointer {
    return getAddressPointerForEvent(this.event)! as GitRepositoryPointer;
  }

  get name() {
    return getGitRepositoryName(this.event);
  }

  get description() {
    return getGitRepositoryDescription(this.event);
  }

  get webUrls() {
    return getGitRepositoryWebUrls(this.event);
  }

  get cloneUrls() {
    return getGitRepositoryCloneUrls(this.event);
  }

  get relays() {
    return getGitRepositoryRelays(this.event);
  }

  get earliestUniqueCommit() {
    return getGitRepositoryEarliestUniqueCommit(this.event);
  }

  get maintainers() {
    return getGitRepositoryMaintainers(this.event);
  }

  get hashtags() {
    return getGitRepositoryHashtags(this.event);
  }

  get personalFork() {
    return isGitRepositoryPersonalFork(this.event);
  }
}
