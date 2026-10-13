import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer, getAddressPointerFromATag } from "applesauce-core/helpers/pointers";
import { processTags } from "applesauce-core/helpers/tags";
import { isSha256 } from "./blossom.js";

/**
 * The event kind for NIP-5D napplet snapshots (regular events)
 * @see https://github.com/nostr-protocol/nips/pull/2303
 */
export const NAPPLET_SNAPSHOT_KIND = 5129;
/**
 * The event kind for NIP-5D root napplets (replaceable events)
 * @see https://github.com/nostr-protocol/nips/pull/2303
 */
export const NAPPLET_ROOT_KIND = 15129;
/**
 * The event kind for NIP-5D named napplets (addressable events)
 * @see https://github.com/nostr-protocol/nips/pull/2303
 */
export const NAPPLET_KIND = 35129;

/** The event kinds of a NIP-5D napplet manifest */
export type NappletKind = typeof NAPPLET_SNAPSHOT_KIND | typeof NAPPLET_ROOT_KIND | typeof NAPPLET_KIND;

/** All NIP-5D napplet manifest kinds */
export const NAPPLET_KINDS: NappletKind[] = [NAPPLET_SNAPSHOT_KIND, NAPPLET_ROOT_KIND, NAPPLET_KIND];

/** The MIME types allowed for a napplet icon */
export const NAPPLET_ICON_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;

/** A MIME type allowed for a napplet icon */
export type NappletIconType = (typeof NAPPLET_ICON_TYPES)[number];

/** A validated NIP-5D napplet manifest event */
export type NappletEvent = KnownEvent<NappletKind>;

/** A NIP-5D napplet snapshot event (kind 5129) */
export type NappletSnapshotEvent = KnownEvent<typeof NAPPLET_SNAPSHOT_KIND>;

/** A NIP-5D root napplet event (kind 15129) */
export type RootNappletEvent = KnownEvent<typeof NAPPLET_ROOT_KIND>;

/** A NIP-5D named napplet event (kind 35129) */
export type NamedNappletEvent = KnownEvent<typeof NAPPLET_KIND>;

/** An intent accepted by a napplet and its advertised parameter names */
export type NappletIntent = { intent: string; params: string[] };

/** A content-addressed napplet icon */
export type NappletIcon = { sha256: string; type: NappletIconType };

const NappletArchetypesSymbol = Symbol.for("napplet-archetypes");
const NappletIntentsSymbol = Symbol.for("napplet-intents");
const NappletRequiredDomainsSymbol = Symbol.for("napplet-required-domains");
const NappletOptionalDomainsSymbol = Symbol.for("napplet-optional-domains");
const NappletServersSymbol = Symbol.for("napplet-servers");

/** Checks if a MIME type is allowed for a napplet icon */
export function isNappletIconType(type: string): type is NappletIconType {
  return (NAPPLET_ICON_TYPES as readonly string[]).includes(type);
}

/** Returns the values of all tags with a name */
function getTagValues(event: NostrEvent, name: string): string[] {
  return processTags(event.tags, (t) => (t[0] === name && t[1] ? t[1] : undefined));
}

/**
 * Checks if an event is a valid NIP-5D napplet manifest
 * @see https://github.com/nostr-protocol/nips/pull/2303
 */
export function isValidNapplet(event?: NostrEvent): event is NappletEvent {
  if (!event || !(NAPPLET_KINDS as number[]).includes(event.kind)) return false;
  if (event.content.trim().length === 0) return false;

  // The manifest must carry exactly one valid "x" tag
  const x = event.tags.filter((t) => t[0] === "x");
  if (x.length !== 1 || !x[0][1] || !isSha256(x[0][1])) return false;

  // Named napplets must have exactly one "d" tag, other kinds must have none
  const d = event.tags.filter((t) => t[0] === "d");
  if (event.kind === NAPPLET_KIND) return d.length === 1 && !!d[0][1];
  return d.length === 0;
}

/** Checks if an event is a napplet snapshot (kind 5129) */
export function isNappletSnapshot(event?: NostrEvent): event is NappletSnapshotEvent {
  return event?.kind === NAPPLET_SNAPSHOT_KIND;
}

/** Checks if an event is a root napplet (kind 15129) */
export function isRootNapplet(event?: NostrEvent): event is RootNappletEvent {
  return event?.kind === NAPPLET_ROOT_KIND;
}

/** Checks if an event is a named napplet (kind 35129) */
export function isNamedNapplet(event?: NostrEvent): event is NamedNappletEvent {
  return event?.kind === NAPPLET_KIND;
}

/** Checks if an event is a valid napplet snapshot manifest */
export function isValidNappletSnapshot(event?: NostrEvent): event is NappletSnapshotEvent {
  return isNappletSnapshot(event) && isValidNapplet(event);
}

/** Checks if an event is a valid root napplet manifest */
export function isValidRootNapplet(event?: NostrEvent): event is RootNappletEvent {
  return isRootNapplet(event) && isValidNapplet(event);
}

/** Checks if an event is a valid named napplet manifest */
export function isValidNamedNapplet(event?: NostrEvent): event is NamedNappletEvent {
  return isNamedNapplet(event) && isValidNapplet(event);
}

/** Returns the identifier from the `d` tag of a named napplet */
export function getNappletIdentifier(event: NostrEvent): string | undefined {
  if (!isNamedNapplet(event)) return undefined;
  return getTagValue(event, "d") || undefined;
}

/** Returns the sha256 of the napplet `index.html` artifact from the `x` tag */
export function getNappletArtifactHash(event: NappletEvent): string;
export function getNappletArtifactHash(event: NostrEvent): string | undefined;
export function getNappletArtifactHash(event: NostrEvent): string | undefined {
  return getTagValue(event, "x");
}

/** Returns the plain-text description of the napplet */
export function getNappletDescription(event: NostrEvent): string {
  return event.content;
}

/** Returns the short display label from the `title` tag */
export function getNappletTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title") || undefined;
}

/** Returns the source URL from the `source` tag */
export function getNappletSource(event: NostrEvent): string | undefined {
  return getTagValue(event, "source") || undefined;
}

/** Returns the Blossom server hints from the `server` tags */
export function getNappletServers(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NappletServersSymbol, () => getTagValues(event, "server"));
}

/** Returns the archetypes from the `z` tags */
export function getNappletArchetypes(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NappletArchetypesSymbol, () => getTagValues(event, "z"));
}

/** Returns the accepted intents and their parameter names from the `i` tags */
export function getNappletIntents(event: NostrEvent): NappletIntent[] {
  return getOrComputeCachedValue(event, NappletIntentsSymbol, () =>
    processTags(event.tags, (t) =>
      t[0] === "i" && t[1] ? { intent: t[1], params: t.slice(2).filter((p) => p.length > 0) } : undefined,
    ),
  );
}

/** Returns the NAP domains required for full functionality from the `R` tags */
export function getNappletRequiredDomains(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NappletRequiredDomainsSymbol, () => getTagValues(event, "R"));
}

/** Returns the optional NAP domains from the `O` tags */
export function getNappletOptionalDomains(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, NappletOptionalDomainsSymbol, () => getTagValues(event, "O"));
}

/** Returns the icon from the `icon` tag, or undefined if the hash or MIME type is invalid */
export function getNappletIcon(event: NostrEvent): NappletIcon | undefined {
  const tag = event.tags.find((t) => t[0] === "icon");
  if (!tag || !tag[1] || !tag[2]) return undefined;
  if (!isSha256(tag[1]) || !isNappletIconType(tag[2])) return undefined;
  return { sha256: tag[1], type: tag[2] };
}

/** Returns the address of the napplet a snapshot derives from (`a` tag) */
export function getNappletParentPointer(event: NostrEvent): AddressPointer | undefined {
  if (!isNappletSnapshot(event)) return undefined;
  const tag = event.tags.find((t) => t[0] === "a" && t[1]);
  return (tag && getAddressPointerFromATag(tag)) || undefined;
}

/** Returns the address of the root napplet a snapshot's lineage originates from (`A` tag) */
export function getNappletRootPointer(event: NostrEvent): AddressPointer | undefined {
  if (!isNappletSnapshot(event)) return undefined;
  const tag = event.tags.find((t) => t[0] === "A" && t[1]);
  return (tag && getAddressPointerFromATag(tag)) || undefined;
}
