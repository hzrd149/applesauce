import { EventOperation } from "applesauce-core/factories";
import { isEvent, NostrEvent } from "applesauce-core/helpers/event";
import { createATagFromAddressPointer } from "applesauce-core/helpers/factory";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";
import { isHexKey } from "applesauce-core/helpers/string";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import {
  GIT_REPOSITORY_KIND,
  getGitRepositoryEarliestUniqueCommit,
  getGitRepositoryReference,
  GitRepositoryPointer,
  isValidGitRepository,
} from "../helpers/git-repository.js";

/**
 * Returns the tags linking a thread to a repository
 * @throws if the event or pointer is not a valid repository
 */
export function createGitRepositoryTags(repo: GitRepositoryPointer | NostrEvent): string[][] {
  if (isEvent(repo) && !isValidGitRepository(repo)) throw new Error("Expected a git repository event");
  const pointer = isEvent(repo) ? getAddressPointerForEvent(repo) : repo;
  if (!pointer || pointer.kind !== GIT_REPOSITORY_KIND || !pointer.identifier || !isHexKey(pointer.pubkey))
    throw new Error("Expected a git repository pointer");
  const tags = [createATagFromAddressPointer(pointer), ["p", pointer.pubkey]];
  const euc = isEvent(repo) ? getGitRepositoryEarliestUniqueCommit(repo) : undefined;
  if (euc) tags.push(["r", euc]);
  return tags;
}

/**
 * Replaces repository tags while preserving commit references and unrelated recipients
 * @throws if the event or pointer is not a valid repository
 */
export function setGitThreadRepository(repo: GitRepositoryPointer | NostrEvent): EventOperation {
  const repoTags = createGitRepositoryTags(repo);
  return modifyPublicTags((tags) => {
    const oldRepo = getGitRepositoryReference({ tags } as NostrEvent);
    const commitTags = tags
      .filter((t) => ["commit", "c", "merge-commit", "applied-as-commits"].includes(t[0]))
      .flatMap((t) => [...new Set(t.slice(1))])
      .filter((id) => tags.some((t) => t[0] === "r" && t[1] === id))
      .map((id) => ["r", id]);
    const next = tags.filter(
      (t) => t[0] !== "a" && t[0] !== "r" && !(t[0] === "p" && (t[1] === oldRepo?.pubkey || t[1] === repoTags[1][1])),
    );
    return [...next, ...commitTags, ...repoTags];
  });
}
