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
  GitRepositoriesListEvent,
  GitRepositoryPointer,
  REPOSITORY_ANNOUNCEMENT_KIND,
} from "../helpers/git-lists.js";
import { NIP51ItemListFactory } from "./list.js";

export type GitRepositoriesTemplate = KnownEventTemplate<typeof GIT_REPOSITORIES_KIND>;
export type GitRepositoryInput = string | GitRepositoryPointer | NostrEvent;

function getRepositoryAddress(repository: GitRepositoryInput): string | GitRepositoryPointer {
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
export class GitRepositoriesFactory extends NIP51ItemListFactory<
  typeof GIT_REPOSITORIES_KIND,
  GitRepositoriesTemplate
> {
  /** Creates a new git repositories list factory */
  static create(): GitRepositoriesFactory {
    return new GitRepositoriesFactory((res) => res(blankEventTemplate(GIT_REPOSITORIES_KIND)));
  }

  /** Creates a new git repositories list factory from an existing list event */
  static modify(event: NostrEvent | KnownEvent<typeof GIT_REPOSITORIES_KIND>): GitRepositoriesFactory {
    if (event.kind !== GIT_REPOSITORIES_KIND) throw new Error("Event is not a git repositories list event");
    return new GitRepositoriesFactory((res) => res(toEventTemplate(event as GitRepositoriesListEvent)));
  }

  /** Adds a NIP-34 repository announcement pointer to the list */
  addRepository(repository: GitRepositoryInput, hidden = false) {
    return this.addAddressItem(getRepositoryAddress(repository), hidden);
  }

  /** Removes a NIP-34 repository announcement pointer from the list */
  removeRepository(repository: GitRepositoryInput, hidden = false) {
    const address = getRepositoryAddress(repository);
    return this.removeAddressItem(typeof address === "string" ? address : getReplaceableAddressFromPointer(address), hidden);
  }
}

export type { GitRepositoriesListEvent, GitRepositoryPointer };
