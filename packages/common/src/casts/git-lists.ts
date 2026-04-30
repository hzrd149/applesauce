import { defined, watchEventUpdates } from "applesauce-core";
import {
  addRelayHintsToPointer,
  hasHiddenTags,
  HiddenContentSigner,
  isHiddenTagsUnlocked,
  NostrEvent,
  unlockHiddenTags,
} from "applesauce-core/helpers";
import { combineLatest, map, of, switchMap } from "rxjs";
import {
  FavoriteGitReposListEvent,
  getFavoriteGitReposPointers,
  getGitAuthors,
  GitAuthorsListEvent,
  isValidFavoriteGitReposList,
  isValidGitAuthorsList,
} from "../helpers/git-lists.js";
import { castEventStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { GitRepository } from "./git-repository.js";

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
    if (!isValidFavoriteGitReposList(event)) throw new Error("Invalid git repositories list");
    super(event, store);
  }

  /** The public NIP-34 repository address pointers in the list */
  get repositoryPointers() {
    return getFavoriteGitReposPointers(this.event);
  }

  /** Returns an observable of {@link GitRepository} casts for the public pointers as they resolve in the store */
  get repositories$() {
    return this.$$ref("repositories$", (store) =>
      this.author.mailboxes$.pipe(
        switchMap((mailboxes) =>
          combineLatest(
            this.repositoryPointers.map((pointer) =>
              store
                .replaceable(
                  // Add outbox relay hints to point if available
                  mailboxes?.outboxes ? addRelayHintsToPointer(pointer, mailboxes?.outboxes) : pointer,
                )
                // Cast all events to GitRepositories
                .pipe(castEventStream(GitRepository, store)),
            ),
          ),
        ),
      ),
    );
  }

  /** The unlocked hidden NIP-34 repository address pointers in the list */
  get hidden() {
    return getFavoriteGitReposPointers(this.event, "hidden");
  }

  /** Returns an observable of the hidden repository pointers as they resolve in the store */
  get hiddenPointers$() {
    return this.$$ref("hiddenPointers$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => event && getFavoriteGitReposPointers(event, "hidden")),
        defined(),
      ),
    );
  }

  /** Returns an observable of {@link GitRepository} casts for the hidden pointers as they resolve in the store */
  get hiddenRepositories$() {
    return this.$$ref("hiddenRepositories$", (store) =>
      combineLatest([this.author.mailboxes$, this.hiddenPointers$]).pipe(
        switchMap(([mailboxes, pointers]) =>
          combineLatest(
            pointers.map((pointer) =>
              store
                // Add outbox relay hints to point if available
                .replaceable(mailboxes?.outboxes ? addRelayHintsToPointer(pointer, mailboxes?.outboxes) : pointer)
                // Cast the event to a GitRepository
                .pipe(castEventStream(GitRepository, store)),
            ),
          ),
        ),
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
