import { sha256 } from "@noble/hashes/sha2.js";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { bytesToHex, getTagValue, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  decodePointer,
  EventPointer,
  getAddressPointerFromATag,
  npubEncode,
} from "applesauce-core/helpers/pointers";
import { processTags } from "applesauce-core/helpers/tags";
import { isSha256 } from "./blossom.js";

/** The event kind for NIP-5A manifest snapshots */
export const NSITE_SNAPSHOT_KIND = 5128;
/** The event kind for NIP-5A root sites */
export const NSITE_ROOT_KIND = 15128;
/** The event kind for NIP-5A named sites */
export const NSITE_KIND = 35128;
/** The event kinds of an nsite manifest */
export type NsiteKind = typeof NSITE_SNAPSHOT_KIND | typeof NSITE_ROOT_KIND | typeof NSITE_KIND;
/** All NIP-5A manifest kinds */
export const NSITE_KINDS: NsiteKind[] = [NSITE_SNAPSHOT_KIND, NSITE_ROOT_KIND, NSITE_KIND];
/** A validated nsite manifest */
export type NsiteEvent = KnownEvent<NsiteKind>;
/** A root site manifest */
export type RootNsiteEvent = KnownEvent<typeof NSITE_ROOT_KIND>;
/** A named site manifest */
export type NamedNsiteEvent = KnownEvent<typeof NSITE_KIND>;
/** A manifest snapshot */
export type NsiteSnapshotEvent = KnownEvent<typeof NSITE_SNAPSHOT_KIND>;
/** A file in an nsite manifest */
export interface NsiteFile {
  /** The absolute path to the file */
  path: string;
  /** The lowercase hexadecimal SHA-256 of the file */
  sha256: string;
}

const FilesSymbol = Symbol.for("nsite-files");
const ServersSymbol = Symbol.for("nsite-servers");
const AppsSymbol = Symbol.for("nsite-apps");
const HashSymbol = Symbol.for("nsite-aggregate-hash");

/** Checks if an identifier fits the canonical named-site DNS label */
export function isValidNsiteIdentifier(identifier: string): boolean {
  return /^[a-z0-9-]{1,13}$/.test(identifier) && !identifier.endsWith("-");
}
/** Checks if a path is absolute and ends in a filename with an extension */
export function isValidNsitePath(path: string): boolean {
  return (
    /^\/(?:[^\r\n?#\\/]+\/)*[^\r\n?#\\/]+\.[^\r\n?#\\/.]+$/u.test(path) &&
    !path.split("/").some((part) => part === "." || part === "..")
  );
}
/** Checks if an address pointer references a root or named site */
export function isNsiteAddressPointer(pointer: AddressPointer): boolean {
  return (
    isSha256(pointer.pubkey) &&
    ((pointer.kind === NSITE_ROOT_KIND && pointer.identifier === "") ||
      (pointer.kind === NSITE_KIND && isValidNsiteIdentifier(pointer.identifier)))
  );
}
/** Checks if an event is a root site */
export function isRootNsite(event?: NostrEvent): event is RootNsiteEvent {
  return event?.kind === NSITE_ROOT_KIND;
}
/** Checks if an event is a named site */
export function isNamedNsite(event?: NostrEvent): event is NamedNsiteEvent {
  return event?.kind === NSITE_KIND;
}
/** Checks if an event is a manifest snapshot */
export function isNsiteSnapshot(event?: NostrEvent): event is NsiteSnapshotEvent {
  return event?.kind === NSITE_SNAPSHOT_KIND;
}

function lineagePointer(event: NostrEvent, name: string): AddressPointer | undefined {
  const tag = event.tags.find((t) => t[0] === name);
  const pointer = tag && /^(15128|35128):[0-9a-f]{64}:/.test(tag[1] ?? "") && getAddressPointerFromATag(tag);
  return pointer && isNsiteAddressPointer(pointer) ? pointer : undefined;
}
/**
 * Checks if an event is a valid NIP-5A manifest
 * @see https://github.com/nostr-protocol/nips/blob/master/5A.md
 */
export function isValidNsite(event?: NostrEvent): event is NsiteEvent {
  if (!event || !(NSITE_KINDS as number[]).includes(event.kind)) return false;
  const paths = event.tags.filter((t) => t[0] === "path");
  if (!paths.length || paths.some((t) => t.length !== 3 || !isValidNsitePath(t[1]) || !isSha256(t[2]))) return false;
  const d = event.tags.filter((t) => t[0] === "d");
  if (isNamedNsite(event) ? d.length !== 1 || !isValidNsiteIdentifier(d[0][1] ?? "") : d.length !== 0) return false;
  const x = event.tags.filter((t) => t[0] === "x");
  if (x.length > 1 || x.some((t) => t.length !== 3 || !isSha256(t[1]) || t[2] !== "aggregate")) return false;
  const a = event.tags.filter((t) => t[0] === "a");
  const A = event.tags.filter((t) => t[0] === "A");
  if (
    a.length > 1 ||
    A.length > 1 ||
    (a.length && !getNsiteParentPointer(event)) ||
    (A.length && !getNsiteRootPointer(event))
  )
    return false;
  if (isNsiteSnapshot(event)) return x.length === 1 && a.length === 1;
  return a.length === A.length;
}
/** Checks if an event is a valid root site */
export function isValidRootNsite(event?: NostrEvent): event is RootNsiteEvent {
  return isRootNsite(event) && isValidNsite(event);
}
/** Checks if an event is a valid named site */
export function isValidNamedNsite(event?: NostrEvent): event is NamedNsiteEvent {
  return isNamedNsite(event) && isValidNsite(event);
}
/** Checks if an event is a valid manifest snapshot */
export function isValidNsiteSnapshot(event?: NostrEvent): event is NsiteSnapshotEvent {
  return isNsiteSnapshot(event) && isValidNsite(event);
}
/** Returns the named site's identifier */
export function getNsiteIdentifier(event: NostrEvent): string | undefined {
  return isNamedNsite(event) ? getTagValue(event, "d") : undefined;
}
/** Returns the site's display title */
export function getNsiteTitle(event: NostrEvent): string | undefined {
  return getTagValue(event, "title");
}
/** Returns the site's description tag */
export function getNsiteDescription(event: NostrEvent): string | undefined {
  return getTagValue(event, "description");
}
/** Returns the site's source repository or archive URL */
export function getNsiteSource(event: NostrEvent): string | undefined {
  return getTagValue(event, "source");
}
/** Returns the valid file mappings from the manifest */
export function getNsiteFiles(event: NostrEvent): NsiteFile[] {
  return getOrComputeCachedValue(event, FilesSymbol, () =>
    processTags(event.tags, (t) =>
      t[0] === "path" && t.length === 3 && isValidNsitePath(t[1]) && isSha256(t[2])
        ? { path: t[1], sha256: t[2] }
        : undefined,
    ),
  );
}
/** Returns the Blossom server hints */
export function getNsiteServers(event: NostrEvent): string[] {
  return getOrComputeCachedValue(event, ServersSymbol, () =>
    processTags(event.tags, (t) => (t[0] === "server" && t[1] ? t[1] : undefined)),
  );
}
/** Returns the upstream addressable app descriptor pointers */
export function getNsiteAppPointers(event: NostrEvent): AddressPointer[] {
  return getOrComputeCachedValue(event, AppsSymbol, () =>
    processTags(event.tags, (t) => {
      if (t[0] !== "app" || !t[1]) return undefined;
      const pointer = getAddressPointerFromATag(t);
      return pointer && pointer.kind >= 30000 && pointer.kind < 40000 ? pointer : undefined;
    }),
  );
}
/** Returns the immediate parent site address */
export function getNsiteParentPointer(event: NostrEvent): AddressPointer | undefined {
  return lineagePointer(event, "a");
}
/** Returns the origin site address of a copy lineage */
export function getNsiteRootPointer(event: NostrEvent): AddressPointer | undefined {
  return lineagePointer(event, "A");
}
/** Returns the advertised aggregate hash */
export function getNsiteAggregateHash(event: NostrEvent): string | undefined {
  const tag = event.tags.find((t) => t[0] === "x" && t[2] === "aggregate");
  return tag?.[1] && isSha256(tag[1]) ? tag[1] : undefined;
}
/** Returns the deterministic SHA-256 of all path tags, including duplicates */
export function computeNsiteAggregateHash(manifest: Pick<NostrEvent, "tags">): string {
  const lines = manifest.tags
    .filter((t) => t[0] === "path")
    .map(([, path, hash]) => `${hash} ${path}\n`)
    .sort()
    .join("");
  return bytesToHex(sha256(new TextEncoder().encode(lines)));
}
/** Returns the cached computed aggregate hash of a manifest */
export function getComputedNsiteAggregateHash(event: NostrEvent): string {
  return getOrComputeCachedValue(event, HashSymbol, () => computeNsiteAggregateHash(event));
}
/** Checks if the advertised aggregate hash matches the manifest's path tags */
export function verifyNsiteAggregateHash(event: NostrEvent): boolean {
  return getNsiteAggregateHash(event) === getComputedNsiteAggregateHash(event);
}
/** Resolves a request path with index.html and 404.html fallbacks */
export function resolveNsitePath(event: NostrEvent, path: string): NsiteFile | undefined {
  if (!path.startsWith("/")) return undefined;
  const file = path.split("/").at(-1)!;
  const resolved = file.includes(".") ? path : `${path.replace(/\/$/, "")}/index.html`;
  const files = getNsiteFiles(event);
  return files.find((f) => f.path === resolved) ?? files.find((f) => f.path === "/404.html");
}

function decodeBase36(value: string): string | undefined {
  let n = 0n;
  for (const char of value) n = n * 36n + BigInt(parseInt(char, 36));
  const hex = n.toString(16);
  return hex.length <= 64 ? hex.padStart(64, "0") : undefined;
}
/**
 * Returns the canonical DNS label for an nsite manifest
 * @throws if the manifest is invalid
 */
export function getNsiteHostLabel(event: NostrEvent): string {
  if (!isValidNsite(event)) throw new Error("Invalid nsite manifest");
  if (isRootNsite(event)) return npubEncode(event.pubkey);
  const hex = isNsiteSnapshot(event) ? event.id : event.pubkey;
  // Fixed width preserves leading-zero keys and the specification's 50-character routing boundary.
  const value = BigInt(`0x${hex}`).toString(36).padStart(50, "0");
  return isNsiteSnapshot(event) ? `v${value}` : `${value}${getNsiteIdentifier(event)}`;
}
/** Parses a canonical nsite DNS label into a site or snapshot pointer */
export function parseNsiteHostLabel(label: string): AddressPointer | EventPointer | undefined {
  if (label.startsWith("npub1")) {
    try {
      const decoded = decodePointer(label);
      return decoded.type === "npub" ? { kind: NSITE_ROOT_KIND, pubkey: decoded.data, identifier: "" } : undefined;
    } catch {
      return undefined;
    }
  }
  if (/^v[0-9a-z]{50}$/.test(label)) {
    const id = decodeBase36(label.slice(1));
    return id ? { id } : undefined;
  }
  if (/^[0-9a-z]{50}[a-z0-9-]{1,13}$/.test(label) && !label.endsWith("-")) {
    const pubkey = decodeBase36(label.slice(0, 50));
    return pubkey ? { kind: NSITE_KIND, pubkey, identifier: label.slice(50) } : undefined;
  }
  return undefined;
}
/**
 * Returns a site's URL on an nsite host
 * @throws if the manifest or host URL is invalid
 */
export function getNsiteURL(event: NostrEvent, host: string | URL): URL {
  const url = new URL(typeof host === "string" && !host.includes("://") ? `https://${host}` : host);
  url.hostname = `${getNsiteHostLabel(event)}.${url.hostname}`;
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url;
}
