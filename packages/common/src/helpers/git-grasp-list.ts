import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { relaySet } from "applesauce-core/helpers/relays";
import { processTags } from "applesauce-core/helpers/tags";

export const GIT_GRASP_LIST_KIND = 10317;
export const GitGraspServersSymbol = Symbol.for("git-grasp-servers");

export type GitGraspListEvent = KnownEvent<typeof GIT_GRASP_LIST_KIND>;

/** Checks if an event is a NIP-34 user grasp server list. */
export function isValidGitGraspList(event?: NostrEvent): event is GitGraspListEvent {
  return !!event && event.kind === GIT_GRASP_LIST_KIND;
}

/** Returns grasp service websocket URLs in preference order. */
export function getGitGraspServers(event?: NostrEvent): string[] {
  if (!isValidGitGraspList(event)) return [];
  return getOrComputeCachedValue(event, GitGraspServersSymbol, () =>
    relaySet(processTags(event.tags, (tag) => (tag[0] === "g" ? tag[1] : undefined))),
  );
}
