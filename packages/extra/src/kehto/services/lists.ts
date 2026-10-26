import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { KehtoAccount } from "../foundation/account.js";
import type { KehtoSignRequest } from "../types.js";
import type { ListsServiceOptions } from "@kehto/services";
import { EventFactory } from "applesauce-core/factories";
import {
  isSafeRelayURL,
  kinds,
  normalizeToPubkey,
  normalizeURL,
  unlockHiddenTags,
  type NostrEvent,
} from "applesauce-core/helpers";
import {
  addAddressPointerTag,
  addEventPointerTag,
  addNameValueTag,
  addProfilePointerTag,
  removeAddressPointerTag,
  removeEventPointerTag,
  removeNameValueTag,
  removeProfilePointerTag,
  setSingletonTag,
} from "applesauce-core/operations/tag/common";
import { firstValueFrom } from "rxjs";
import { kehtoAccount$ } from "../foundation/account.js";
import { publishThroughStore } from "../foundation/pool.js";
import { getStoredOutboxes } from "../foundation/relays.js";
import { createApprovingSigner } from "../foundation/signer.js";
import { configured$, errorMessage, settle } from "../helpers.js";

/** Options for {@link createListsOptions} */
export interface KehtoListsOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The relay pool used for napplet traffic */
  pool: RelayPool;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution when provided */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The host callback approving a napplet signing request */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
  /** The lists napplets may modify */
  lists?: typeof KEHTO_LISTS;
}

type Lists = Required<ListsServiceOptions>;
type ListRef = Parameters<Lists["add"]>[0];
type ListItem = Parameters<Lists["add"]>[1][number];
type ListOptions = NonNullable<Parameters<Lists["add"]>[2]>;
type ListMutationResult = Awaited<ReturnType<Lists["add"]>>;
type ListSupport = Awaited<ReturnType<Lists["supported"]>>[number];
type ListItemType = ListItem["itemType"];

/** A NIP-51 list the lists service can modify, and the tag each item type is stored in */
export interface KehtoListDefinition extends ListSupport {
  /** The tag name each supported item type is written to */
  tags: Partial<Record<ListItemType, string>>;
}

const defineList = (
  kind: number,
  type: string,
  tags: KehtoListDefinition["tags"],
  addressable = false,
  privateItems = true,
): KehtoListDefinition => ({
  kind,
  type,
  addressable,
  privateItems,
  tags,
  supportedItemTypes: Object.keys(tags) as ListItemType[],
});

/** The NIP-51 lists napplets can modify, named after the NIP-51 tables */
export const KEHTO_LISTS: KehtoListDefinition[] = [
  defineList(kinds.Contacts, "follow-list", { pubkey: "p" }, false, false),
  defineList(kinds.Mutelist, "mute-list", { pubkey: "p", hashtag: "t", word: "word", event: "e" }),
  defineList(kinds.Pinlist, "pinned-notes", { event: "e" }),
  defineList(kinds.BookmarkList, "bookmarks", { event: "e", address: "a", hashtag: "t", url: "r" }),
  defineList(kinds.CommunitiesList, "communities", { address: "a" }),
  defineList(kinds.PublicChatsList, "public-chats", { event: "e" }),
  defineList(kinds.BlockedRelaysList, "blocked-relays", { relay: "relay" }),
  defineList(kinds.SearchRelaysList, "search-relays", { relay: "relay" }),
  defineList(10009, "simple-groups", { group: "group" }),
  defineList(10012, "favorite-relays", { relay: "relay", address: "a" }),
  defineList(kinds.InterestsList, "interests", { hashtag: "t", address: "a" }),
  defineList(kinds.UserEmojiList, "emojis", { address: "a" }),
  defineList(kinds.DirectMessageRelaysList, "dm-relays", { relay: "relay" }),
  defineList(10063, "blossom-servers", { server: "server" }),
  defineList(kinds.Followsets, "follow-sets", { pubkey: "p" }, true),
  defineList(kinds.Relaysets, "relay-sets", { relay: "relay" }, true),
  defineList(kinds.Bookmarksets, "bookmark-sets", { event: "e", address: "a", hashtag: "t", url: "r" }, true),
  defineList(kinds.Curationsets, "curation-sets", { event: "e", address: "a" }, true),
  defineList(kinds.Interestsets, "interest-sets", { hashtag: "t" }, true),
];

const publicSupport = (lists: KehtoListDefinition[]): ListSupport[] =>
  lists.map(({ tags: _tags, ...support }) => support);

class ListError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Finds the list definition for a NAP list reference */
function resolveList(lists: KehtoListDefinition[], ref: ListRef) {
  const definition = lists.find((definition) =>
    ref.kind !== undefined ? definition.kind === ref.kind : definition.type === ref.type,
  );
  if (!definition) throw new ListError("unsupported-list", "list kind or type is not supported");

  const identifier = ref.identifier || undefined;
  if (definition.addressable && !identifier)
    throw new ListError("missing-identifier", "addressable lists require an identifier");
  if (!definition.addressable && identifier)
    throw new ListError("invalid-list-ref", "replaceable lists do not accept an identifier");
  return { definition, identifier };
}

/** Normalizes an item value and returns the tag it is stored as */
function itemTag(definition: KehtoListDefinition, item: ListItem): string[] {
  const name = definition.tags[item.itemType];
  if (!name) throw new ListError("unsupported-item", `${item.itemType} is not supported by ${definition.type}`);
  if (item.visibility === "private" && !definition.privateItems)
    throw new ListError("private-items-unsupported", `${definition.type} does not support private items`);

  const value = item.value.trim();
  switch (item.itemType) {
    case "pubkey": {
      const pubkey = normalizeToPubkey(value);
      if (!pubkey) throw new ListError("invalid-item", "pubkey values must be hex, npub or nprofile");
      return [name, pubkey];
    }
    case "event":
      if (!/^[0-9a-f]{64}$/i.test(value)) throw new ListError("invalid-item", "event values must be 32-byte hex");
      return [name, value.toLowerCase()];
    case "address":
      if (!/^\d+:[0-9a-f]{64}:/i.test(value))
        throw new ListError("invalid-item", "address values must be kind:pubkey:d");
      return [name, value];
    case "relay":
      if (!isSafeRelayURL(value)) throw new ListError("invalid-item", "relay values must be ws or wss URLs");
      return [name, normalizeURL(value)];
    case "hashtag":
      return [name, value.replace(/^#/, "").toLocaleLowerCase()];
    default:
      if (!value) throw new ListError("invalid-item", "list item value is empty");
      return [name, value];
  }
}

/** Returns the tag operation that adds or removes an item tag */
function tagOperation(tag: string[], add: boolean) {
  const [name, value] = tag;
  if (name === "p") return add ? addProfilePointerTag(value) : removeProfilePointerTag(value);
  if (name === "e") return add ? addEventPointerTag(value) : removeEventPointerTag(value);
  if (name === "a") return add ? addAddressPointerTag(value) : removeAddressPointerTag(value);
  return add ? addNameValueTag([name, value], false) : removeNameValueTag([name, value]);
}

/** Creates {@link ListsServiceOptions} that modify NIP-51 lists with applesauce tag operations */
export function createListsOptions(config: KehtoListsOptions): ListsServiceOptions {
  const { eventStore, lists = KEHTO_LISTS } = config;

  async function mutate(
    add: boolean,
    ref: ListRef,
    items: readonly ListItem[],
    options: ListOptions | undefined,
    windowId: string,
  ): Promise<ListMutationResult> {
    try {
      const account = await firstValueFrom(kehtoAccount$(config));
      if (!account) return { ok: false, error: "no-signer", reason: "no signer configured" };

      const { signer: accountSigner, pubkey } = account;
      const signer = createApprovingSigner(accountSigner, { approve: config.approve, windowId })!;

      const { definition, identifier } = resolveList(lists, ref);
      const tags = items.map((item) => ({ tag: itemTag(definition, item), hidden: item.visibility === "private" }));

      const existing: NostrEvent | undefined = await settle(
        eventStore.replaceable({ kind: definition.kind, pubkey, identifier }),
        undefined,
        config.timeout ?? 4000,
      );
      if (!existing && !add) return { ok: true, removed: 0, skipped: items.length };
      if (!existing && options?.create === false)
        return { ok: false, error: "not-found", reason: "list does not exist" };

      // Count items that are already in (or missing from) the list so no-op mutations are reported as skipped
      const needsHiddenTags = existing && tags.some((item) => item.hidden);
      const hiddenTags = needsHiddenTags ? await unlockHiddenTags(existing, signer) : [];
      const publicTags = existing?.tags ?? [];

      const isPresent = (tag: string[], hidden: boolean) => {
        const existingTags = hidden ? hiddenTags : publicTags;
        return existingTags.some((existingTag) => existingTag[0] === tag[0] && existingTag[1] === tag[1]);
      };
      const seen = new Set<string>();
      const changed = tags.filter(({ tag, hidden }) => {
        const key = JSON.stringify([hidden, tag]);
        if (seen.has(key) || isPresent(tag, hidden) === add) return false;
        seen.add(key);
        return true;
      });
      if (changed.length === 0) return { ok: true, [add ? "added" : "removed"]: 0, skipped: items.length };

      let factory = existing ? EventFactory.fromEvent(existing) : EventFactory.fromKind(definition.kind);
      if (!existing && identifier) {
        factory = factory.modifyPublicTags(setSingletonTag(["d", identifier]));
      }

      factory = factory.as(
        createApprovingSigner(accountSigner, {
          approve: config.approve,
          windowId,
          minimumTimestamp: existing ? existing.created_at + 1 : 0,
        })!,
      );

      const metadataTags = [
        ["title", options?.title],
        ["description", options?.description],
        ["image", options?.image],
      ] as const;
      for (const [name, value] of metadataTags) {
        if (value) factory = factory.modifyPublicTags(setSingletonTag([name, value]));
      }

      const publicOperations = changed.filter((item) => !item.hidden).map((item) => tagOperation(item.tag, add));
      const hiddenOperations = changed.filter((item) => item.hidden).map((item) => tagOperation(item.tag, add));
      if (publicOperations.length) factory = factory.modifyPublicTags(...publicOperations);
      if (hiddenOperations.length) factory = factory.modifyHiddenTags(...hiddenOperations);

      const event = await factory.sign();
      const outboxes = getStoredOutboxes(config.eventStore, pubkey);
      await publishThroughStore(
        config,
        outboxes.length
          ? outboxes
          : await firstValueFrom(configured$(config.fallbackRelays, [])),
        event,
      );
      return {
        ok: true,
        eventId: event.id,
        event,
        [add ? "added" : "removed"]: changed.length,
        skipped: items.length - changed.length,
      };
    } catch (err) {
      if (err instanceof ListError)
        return { ok: false, error: err.code, reason: err.message, supported: publicSupport(lists) };
      return { ok: false, error: "failed", reason: errorMessage(err) };
    }
  }

  return {
    supported: () => publicSupport(lists),
    add: (ref, items, options, { windowId }) => mutate(true, ref, items, options, windowId),
    remove: (ref, items, options, { windowId }) => mutate(false, ref, items, options, windowId),
  };
}
