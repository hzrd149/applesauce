// CORD-05 Invites — the shareable-link codec whose keys live in an encrypted
// bundle.
//
// A link is `$BASE/invite/<naddr>#<fragment>`. The naddr is a public locator
// (kind 33301, link_signer, ""), the fragment carries the 16-byte unlock token
// plus bootstrap relays and never reaches a server. The token derives the
// bundle decrypt key; the bundle carries the community access keys. The event
// templates that anchor a link live in ../operations/invite.js.

import { randomBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";
import { getCachedValue, getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { nip44 } from "applesauce-core/helpers/encryption";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";
import { decodePointer, naddrEncode } from "applesauce-core/helpers/pointers";
import { notifyEventUpdate } from "applesauce-core/helpers";
import type { AddressPointer, KnownEvent, NostrEvent } from "applesauce-core/helpers";
import { inviteBundleKey } from "./crypto.js";
import type { InviteBundle } from "../types.js";

/** Concord invite bundle kind (CORD-05 §1). */
export const INVITE_BUNDLE_KIND = 33301;

/** The `vsk` tag value of a live invite bundle (CORD-05 §1). */
export const INVITE_BUNDLE_VSK_LIVE = 6;
/** The `vsk` tag value of a revoked invite bundle tombstone (CORD-05 §2). */
export const INVITE_BUNDLE_VSK_REVOKED = 9;

const FRAGMENT_VERSION = 4;
const FLAG_STOCK_SET = 0x01;

// CORD-05 §3 relay dictionary.
export const RELAY_DICTIONARY: Record<number, string> = {
  1: "wss://jskitty.com/nostr",
  2: "wss://asia.vectorapp.io/nostr",
  3: "wss://relay.ditto.pub",
  4: "wss://relay.dreamith.to",
};
export const STOCK_RELAYS = [1, 2, 3, 4].map((i) => RELAY_DICTIONARY[i]);

function relaysAreStock(relays: string[]): boolean {
  return relays.length === STOCK_RELAYS.length && relays.every((r, i) => r === STOCK_RELAYS[i]);
}

/** Encode the fragment: [version][flags][relays?][token:16], base64url no pad. */
export function encodeFragment(token: Uint8Array, relays: string[]): string {
  const bytes: number[] = [FRAGMENT_VERSION];
  if (relaysAreStock(relays)) {
    bytes.push(FLAG_STOCK_SET);
  } else {
    bytes.push(0x00);
    const boot = relays.slice(0, 3); // at most 3 bootstrap relays
    bytes.push(boot.length);
    for (const url of boot) {
      const dictId = Number(Object.keys(RELAY_DICTIONARY).find((k) => RELAY_DICTIONARY[Number(k)] === url));
      if (dictId) {
        bytes.push(dictId);
      } else if (url.startsWith("wss://")) {
        const host = url.slice("wss://".length);
        const enc = new TextEncoder().encode(host);
        bytes.push(0x00, enc.length, ...enc);
      } else {
        const enc = new TextEncoder().encode(url);
        bytes.push(0xff, enc.length, ...enc);
      }
    }
  }
  bytes.push(...token);
  return base64urlnopad.encode(new Uint8Array(bytes));
}

export function decodeFragment(fragment: string): { token: Uint8Array; relays: string[] } {
  const bytes = base64urlnopad.decode(fragment);
  let i = 0;
  const version = bytes[i++];
  if (version < FRAGMENT_VERSION) throw new Error("legacy invite link, unsupported");
  const flags = bytes[i++];
  const relays: string[] = [];
  if (flags & FLAG_STOCK_SET) {
    relays.push(...STOCK_RELAYS);
  } else {
    const count = bytes[i++];
    for (let n = 0; n < count; n++) {
      const lead = bytes[i++];
      if (lead >= 1 && lead <= 254) {
        relays.push(RELAY_DICTIONARY[lead] ?? "");
      } else if (lead === 0x00) {
        const len = bytes[i++];
        const host = new TextDecoder().decode(bytes.slice(i, i + len));
        i += len;
        relays.push("wss://" + host);
      } else {
        const len = bytes[i++];
        relays.push(new TextDecoder().decode(bytes.slice(i, i + len)));
        i += len;
      }
    }
  }
  const token = bytes.slice(i, i + 16);
  return { token, relays: relays.filter(Boolean) };
}

export interface ParsedInvite {
  linkSigner: string;
  token: Uint8Array;
  bootstrapRelays: string[];
}

export function parseInviteLink(url: string): ParsedInvite {
  const hashIndex = url.indexOf("#");
  if (hashIndex < 0) throw new Error("invite link missing fragment");
  const fragment = url.slice(hashIndex + 1);
  const path = url.slice(0, hashIndex);
  const naddr = path.slice(path.lastIndexOf("/") + 1);
  const decoded = decodePointer(naddr);
  if (decoded.type !== "naddr") throw new Error("invalid invite naddr");
  const { token, relays } = decodeFragment(fragment);
  return { linkSigner: decoded.data.pubkey, token, bootstrapRelays: relays };
}

export function buildInviteLink(base: string, linkSignerPubkey: string, token: Uint8Array, relays: string[]): string {
  const naddr = naddrEncode({ identifier: "", pubkey: linkSignerPubkey, kind: INVITE_BUNDLE_KIND, relays: [] });
  return `${base.replace(/\/$/, "")}/invite/${naddr}#${encodeFragment(token, relays)}`;
}

export function newInviteToken(): Uint8Array {
  return randomBytes(16);
}

export function encryptBundle(bundle: InviteBundle, token: Uint8Array): string {
  return nip44.encrypt(JSON.stringify(bundle), inviteBundleKey(token));
}

export function decryptBundle(content: string, token: Uint8Array): InviteBundle {
  return JSON.parse(nip44.decrypt(content, inviteBundleKey(token))) as InviteBundle;
}

// ── Event-level helpers (addressable kind 33301, authored by the link_signer) ─

/** A validated Concord invite bundle event (kind 33301). */
export type InviteBundleEvent = KnownEvent<typeof INVITE_BUNDLE_KIND>;

/** Validates that an event is a Concord invite bundle (kind 33301). */
export function isValidInviteBundle(event: NostrEvent): event is InviteBundleEvent {
  return event.kind === INVITE_BUNDLE_KIND;
}

/** The bundle's `vsk` edition tag (defaults to live, CORD-05 §1). */
export function getInviteBundleVsk(event: NostrEvent): number {
  const raw = event.tags.find((t) => t[0] === "vsk")?.[1];
  return raw === undefined ? INVITE_BUNDLE_VSK_LIVE : Number(raw);
}

/** Whether the bundle is a revocation tombstone (vsk 9, CORD-05 §2). */
export function isInviteBundleRevoked(event: NostrEvent): boolean {
  return getInviteBundleVsk(event) === INVITE_BUNDLE_VSK_REVOKED;
}

/** The addressable pointer (kind 33301, link_signer, `""`) locating this bundle. */
export function getInviteBundlePointer(event: NostrEvent): AddressPointer {
  return getAddressPointerForEvent(event)!;
}

/** Symbol for caching the decrypted invite bundle on an event. */
export const InviteBundleSymbol = Symbol.for("concord-invite-bundle");

/** Decrypts the invite bundle with the link's unlock token, caching the result on the event. */
export function getInviteBundle(event: NostrEvent, token: Uint8Array): InviteBundle {
  return getOrComputeCachedValue(event, InviteBundleSymbol, () => decryptBundle(event.content, token));
}

/**
 * Whether the decrypted invite bundle plaintext is cached (unlocked) on the event. Mirrors
 * {@link isInviteListUnlocked} for the token-encrypted bundle family.
 */
export function isInviteBundleUnlocked(event: NostrEvent): boolean {
  return getCachedValue(event, InviteBundleSymbol) !== undefined;
}

/** The decrypted invite bundle if the event has been unlocked, otherwise undefined. */
export function getInviteBundleContent(event: NostrEvent): InviteBundle | undefined {
  return getCachedValue(event, InviteBundleSymbol);
}

/**
 * Decrypts the invite bundle with the link's unlock token, caches it on the event, and notifies
 * subscribers so reactive readers re-emit — mirroring {@link unlockInviteList}. A no-op that returns
 * the cached bundle if already unlocked.
 */
export function unlockInviteBundle(event: NostrEvent, token: Uint8Array): InviteBundle {
  if (isInviteBundleUnlocked(event)) return getInviteBundleContent(event)!;
  const bundle = getInviteBundle(event, token);
  notifyEventUpdate(event);
  return bundle;
}
