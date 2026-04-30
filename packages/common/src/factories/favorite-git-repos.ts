import { blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEvent, KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import {
  getAddressPointerForEvent,
  getReplaceableAddressFromPointer,
  isAddressPointer,
  parseReplaceableAddress,
} from "applesauce-core/helpers/pointers";
import {
  GIT_REPOSITORIES_KIND,
  FavoriteGitReposListEvent,
  GitRepositoryPointer,
  REPOSITORY_ANNOUNCEMENT_KIND,
} from "../helpers/git-lists.js";
import { NIP51ItemListFactory } from "./list.js";

export type FavoriteGitReposTemplate = KnownEventTemplate<typeof GIT_REPOSITORIES_KIND>;
export type FavoriteGitRepoInput = string | GitRepositoryPointer | NostrEvent;

function getRepositoryAddress(repository: FavoriteGitRepoInput): string | GitRepositoryPointer {
  if (typeof repository === "string") {
    const pointer = parseReplaceableAddress(repository, true);
    if (pointer?.kind !== REPOSITORY_ANNOUNCEMENT_KIND) throw new Error("Repository address must be kind 30617");
    return repository;
  }

  if (isAddressPointer(repository)) {
    if (repository.kind !== REPOSITORY_ANNOUNCEMENT_KIND) throw new Error("Repository pointer must be kind 30617");
    return repository;
  }

  const pointer = getAddressPointerForEvent(repository);
  if (pointer?.kind !== REPOSITORY_ANNOUNCEMENT_KIND) throw new Error("Repository event must be kind 30617");
  return pointer as GitRepositoryPointer;
}

/** A factory class for building kind 10018 git repositories list events */
export class FavoriteGitReposFactory extends NIP51ItemListFactory<
  typeof GIT_REPOSITORIES_KIND,
  FavoriteGitReposTemplate
> {
  /** Creates a new git repositories list factory */
  static create(): FavoriteGitReposFactory {
    return new FavoriteGitReposFactory((res) => res(blankEventTemplate(GIT_REPOSITORIES_KIND)));
  }

  /** Creates a new git repositories list factory from an existing list event */
  static modify(event: NostrEvent | KnownEvent<typeof GIT_REPOSITORIES_KIND>): FavoriteGitReposFactory {
    if (event.kind !== GIT_REPOSITORIES_KIND) throw new Error("Event is not a git repositories list event");
    return new FavoriteGitReposFactory((res) => res(toEventTemplate(event as FavoriteGitReposListEvent)));
  }

  /** Adds a NIP-34 repository announcement pointer to the list */
  addRepository(repository: FavoriteGitRepoInput, hidden = false) {
    return this.addAddressItem(getRepositoryAddress(repository), hidden);
  }

  /** Removes a NIP-34 repository announcement pointer from the list */
  removeRepository(repository: FavoriteGitRepoInput, hidden = false) {
    const address = getRepositoryAddress(repository);
    return this.removeAddressItem(
      typeof address === "string" ? address : getReplaceableAddressFromPointer(address),
      hidden,
    );
  }
}

export type { FavoriteGitReposListEvent as GitRepositoriesListEvent, GitRepositoryPointer };
