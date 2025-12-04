import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getReplaceableIdentifier, getTagValue, NostrEvent } from "applesauce-core/helpers/event";
import { getHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { fillAndTrimTag, NameValueTag, processTags } from "applesauce-core/helpers/tags";
import { ensureWebSocketURL, normalizeURL } from "applesauce-core/helpers/url";

export const GROUPS_LIST_KIND = 10009;
export const GROUP_MESSAGE_KIND = 9;

/** NIP-29 group pointer */
export type GroupPointer = {
  /** the id of the group */
  id: string;
  /** The url to the relay with wss:// or ws:// protocol */
  relay: string;
  /** The name of the group */
  name?: string;
};

/** decodes a group identifier into a group pointer object */
export function decodeGroupPointer(str: string): GroupPointer | null {
  let [relay, id] = str.split("'");
  if (!relay) return null;

  // Prepend wss:// if missing
  if (!relay.match(/^wss?:/)) relay = `wss://${relay}`;

  // Normalize the relay url
  relay = normalizeURL(relay);

  return { relay, id: id || "_" };
}

/** Converts a group pointer into a group identifier */
export function encodeGroupPointer(pointer: GroupPointer): string {
  const hostname = URL.canParse(pointer.relay) ? new URL(pointer.relay).hostname : pointer.relay;

  return `${hostname}'${pointer.id}`;
}

export const GroupsPublicSymbol = Symbol.for("groups-public");
export const GroupsHiddenSymbol = Symbol.for("groups-hidden");

/** gets a {@link GroupPointer} from a "h" tag if it has a relay hint */
export function getGroupPointerFromHTag(tag: string[]): GroupPointer | undefined {
  const [_, id, relay] = tag;
  if (!id || !relay) return undefined;
  return { id, relay };
}

/** gets a {@link GroupPointer} from a "group" tag */
export function getGroupPointerFromGroupTag(tag: string[]): GroupPointer {
  const [_, id, relay, name] = tag;
  return { id, relay, name };
}

/** Returns all the public groups from a k:10009 list */
export function getPublicGroups(bookmark: NostrEvent): GroupPointer[] {
  return getOrComputeCachedValue(bookmark, GroupsPublicSymbol, () =>
    processTags(
      bookmark.tags.filter((t) => t[0] === "group"),
      getGroupPointerFromGroupTag,
    ),
  );
}

/** Returns all the hidden groups from a k:10009 list */
export function getHiddenGroups(bookmark: NostrEvent): GroupPointer[] | undefined {
  return getOrComputeCachedValue(bookmark, GroupsHiddenSymbol, () => {
    const tags = getHiddenTags(bookmark);
    return (
      tags &&
      processTags(
        bookmark.tags.filter((t) => t[0] === "group"),
        getGroupPointerFromGroupTag,
      )
    );
  });
}

/** Gets a {@link GroupPointer} from a kind 39000 group metadata event */
export function getGroupPointerFromMetadata(event: NostrEvent, relay: string): GroupPointer | undefined {
  // Use the "d" tag for the group ID and the provided relay
  const groupId = getReplaceableIdentifier(event) || "_";
  const name = getTagValue(event, "name");

  return {
    id: groupId,
    relay: relay,
    name: name,
  };
}

/** Creates a "h" tag for chat messages from a {@link GroupPointer} */
export function createGroupHTagFromGroupPointer(group: GroupPointer): NameValueTag {
  return fillAndTrimTag(["h", group.id, ensureWebSocketURL(group.relay)]) as NameValueTag;
}

/** Creates a "group" tag from a {@link GroupPointer} */
export function createGroupTagFromGroupPointer(group: GroupPointer): NameValueTag {
  return fillAndTrimTag(["group", group.id, ensureWebSocketURL(group.relay), group.name], 3) as NameValueTag;
}
