import { castUser, ChainableObservable } from "applesauce-core";
import { User } from "applesauce-core/casts/user";
import { getAddressPointerForEvent } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { castEventStream, castTimelineStream } from "applesauce-core/observable/cast-stream";
import { map, of } from "rxjs";

import { FAVORITE_GIT_REPOS_KIND } from "../helpers/git-lists.js";
import {
  getGitRepositoryCloneUrls,
  getGitRepositoryDescription,
  getGitRepositoryEarliestUniqueCommit,
  getGitRepositoryHashtags,
  getGitRepositoryIdentifier,
  getGitRepositoryMaintainers,
  getGitRepositoryName,
  getGitRepositoryRelays,
  getGitRepositoryUpstream,
  getGitRepositoryWebUrls,
  GitRepositoryEvent,
  GitRepositoryPointer,
  isValidGitRepository,
} from "../helpers/git-repository.js";
import { ReactionsModel } from "../models/reactions.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { Reaction } from "./reaction.js";

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
    return this.maintainerPubkeys.map((pubkey) => castUser(pubkey, this.store));
  }

  get maintainerPubkeys() {
    return getGitRepositoryMaintainers(this.event);
  }

  get hashtags() {
    return getGitRepositoryHashtags(this.event);
  }

  /** Pointer to the upstream repository this one was forked from, if declared. */
  get upstream() {
    return getGitRepositoryUpstream(this.event);
  }

  /** Subscribes  the upstream {@link GitRepository} if there is one, otherwise `undefined`. */
  get upstream$(): ChainableObservable<GitRepository | undefined> {
    return this.$$ref("upstream$", (store) =>
      this.upstream ? store.replaceable(this.upstream).pipe(castEventStream(GitRepository)) : of(undefined),
    );
  }

  /** Returns a timeline of users who have favorited this git repository */
  get followers$(): ChainableObservable<User[]> {
    return this.$$ref("followers$", (store) =>
      store
        .timeline({ kinds: [FAVORITE_GIT_REPOS_KIND], "#a": [this.coordinate!] })
        .pipe(map((events) => events.map((event) => castUser(event, store)))),
    );
  }

  /** Returns a timeline of all reactions to this git repository */
  get reactions$(): ChainableObservable<Reaction[]> {
    return this.$$ref("reactions$", (store) =>
      store.model(ReactionsModel, this.event).pipe(castTimelineStream(Reaction, store)),
    );
  }
}
