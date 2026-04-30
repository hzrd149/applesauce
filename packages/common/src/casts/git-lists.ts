import { defined, watchEventUpdates } from "applesauce-core";
import {
  hasHiddenTags,
  HiddenContentSigner,
  isHiddenTagsUnlocked,
  NostrEvent,
  unlockHiddenTags,
} from "applesauce-core/helpers";
import { map, of } from "rxjs";
import {
  getGitAuthors,
  getGitRepositories,
  GitAuthorsListEvent,
  FavoriteGitReposListEvent,
  isValidGitAuthorsList,
  isValidGitRepositoriesList,
} from "../helpers/git-lists.js";
import { CastRefEventStore, EventCast } from "./cast.js";

/** Class for git authors lists (kind 10017) */
export class GitAuthors extends EventCast<GitAuthorsListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitAuthorsList(event)) throw new Error("Invalid git authors list");
    super(event, store);
  }

  /** The public git authors in the list */
  get authors() {
    return getGitAuthors(this.event);
  }

  /** The public git author pubkeys in the list */
  get pubkeys() {
    return this.authors.map((author) => author.pubkey);
  }

  /** The unlocked hidden git authors in the list */
  get hidden() {
    return getGitAuthors(this.event, "hidden");
  }

  /** An observable that updates when the hidden authors are unlocked */
  get hidden$() {
    return this.$$ref("hidden$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getGitAuthors(event, "hidden")),
        defined(),
      ),
    );
  }

  /** Whether the list has hidden authors */
  get hasHidden() {
    return hasHiddenTags(this.event);
  }

  /** Whether the list is unlocked */
  get unlocked() {
    return isHiddenTagsUnlocked(this.event);
  }

  /** Unlocks the hidden authors on the list */
  async unlock(signer: HiddenContentSigner) {
    await unlockHiddenTags(this.event, signer);
    return this.hidden;
  }
}

/** Class for git repositories lists (kind 10018) */
export class FavoriteGitRepos extends EventCast<FavoriteGitReposListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidGitRepositoriesList(event)) throw new Error("Invalid git repositories list");
    super(event, store);
  }

  /** The public NIP-34 repositories in the list */
  get repositories() {
    return getGitRepositories(this.event);
  }

  /** The unlocked hidden NIP-34 repositories in the list */
  get hidden() {
    return getGitRepositories(this.event, "hidden");
  }

  /** An observable that updates when the hidden repositories are unlocked */
  get hidden$() {
    return this.$$ref("hidden$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getGitRepositories(event, "hidden")),
        defined(),
      ),
    );
  }

  /** Whether the list has hidden repositories */
  get hasHidden() {
    return hasHiddenTags(this.event);
  }

  /** Whether the list is unlocked */
  get unlocked() {
    return isHiddenTagsUnlocked(this.event);
  }

  /** Unlocks the hidden repositories on the list */
  async unlock(signer: HiddenContentSigner) {
    await unlockHiddenTags(this.event, signer);
    return this.hidden;
  }
}
