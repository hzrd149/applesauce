import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { setHiddenTagsEncryptionMethod } from "applesauce-core/helpers/hidden-tags";
import { AddressPointer, ProfilePointer } from "applesauce-core/helpers/pointers";
import { getAddressPointersFromList, getProfilePointersFromList, ReadListTags } from "./lists.js";

/** NIP-51 git authors list kind */
export const GIT_AUTHORS_KIND = 10017;
/** NIP-51 git repositories list kind */
export const GIT_REPOSITORIES_KIND = 10018;
/** NIP-34 repository announcement event kind */
export const REPOSITORY_ANNOUNCEMENT_KIND = 30617;

export type GitAuthorsListEvent = KnownEvent<typeof GIT_AUTHORS_KIND>;
export type FavoriteGitReposListEvent = KnownEvent<typeof GIT_REPOSITORIES_KIND>;
export type GitRepositoryPointer = AddressPointer & { kind: typeof REPOSITORY_ANNOUNCEMENT_KIND };

// Set the default encrypted content method for the kinds
setHiddenTagsEncryptionMethod(GIT_AUTHORS_KIND, "nip44");
setHiddenTagsEncryptionMethod(GIT_REPOSITORIES_KIND, "nip44");

/** Validates that an event is a NIP-51 git authors list */
export function isValidGitAuthorsList(event: NostrEvent): event is GitAuthorsListEvent {
  return event.kind === GIT_AUTHORS_KIND;
}

/** Validates that an event is a NIP-51 git repositories list */
export function isValidGitRepositoriesList(event: NostrEvent): event is FavoriteGitReposListEvent {
  return event.kind === GIT_REPOSITORIES_KIND;
}

/** Returns git author profile pointers from a git authors list */
export function getGitAuthors(list: NostrEvent, type?: ReadListTags): ProfilePointer[] {
  return getProfilePointersFromList(list, type);
}

/** Returns NIP-34 repository pointers from a git repositories list */
export function getGitRepositories(list: NostrEvent, type?: ReadListTags): GitRepositoryPointer[] {
  return getAddressPointersFromList(list, type).filter(
    (pointer): pointer is GitRepositoryPointer => pointer.kind === REPOSITORY_ANNOUNCEMENT_KIND,
  );
}
