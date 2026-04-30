import { EventOperation } from "applesauce-core/factories";
import { normalizeRelayUrl, relaySet } from "applesauce-core/helpers/relays";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyPublicTags } from "applesauce-core/operations/tags";

/** Adds a grasp server URL. */
export function addGitGraspServer(url: string): EventOperation {
  return modifyPublicTags(addRelayTag(normalizeRelayUrl(url), "g"));
}

/** Removes a grasp server URL. */
export function removeGitGraspServer(url: string): EventOperation {
  return modifyPublicTags(removeRelayTag(normalizeRelayUrl(url), "g"));
}

/** Replaces all grasp servers. */
export function setGitGraspServers(urls: string[]): EventOperation {
  return modifyPublicTags((tags) => [
    ...tags.filter((tag) => tag[0] !== "g"),
    ...relaySet(urls).map((url) => ["g", url]),
  ]);
}
