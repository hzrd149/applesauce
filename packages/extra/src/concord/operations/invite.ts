// CORD-05 Invites — shareable links whose keys live in an encrypted bundle.
//
// A link is `$BASE/invite/<naddr>#<fragment>`. The naddr is a public locator
// (kind 33301, link_signer, ""), the fragment carries the 16-byte unlock token
// plus bootstrap relays and never reaches a server. The token derives the
// bundle decrypt key; the bundle carries the community access keys.

import { nip19, nip44 } from "nostr-tools";
import { fromBase64url, randomBytes, toBase64url } from "../bytes.js";
import { inviteBundleKey } from "../helpers/crypto.js";
import { KIND } from "../types.js";
import type { InviteBundle } from "../types.js";

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
      const dictId = Number(
        Object.keys(RELAY_DICTIONARY).find((k) => RELAY_DICTIONARY[Number(k)] === url),
      );
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
  return toBase64url(new Uint8Array(bytes));
}

export function decodeFragment(fragment: string): { token: Uint8Array; relays: string[] } {
  const bytes = fromBase64url(fragment);
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
  const decoded = nip19.decode(naddr);
  if (decoded.type !== "naddr") throw new Error("invalid invite naddr");
  const { token, relays } = decodeFragment(fragment);
  return { linkSigner: decoded.data.pubkey, token, bootstrapRelays: relays };
}

export function buildInviteLink(base: string, linkSignerPubkey: string, token: Uint8Array, relays: string[]): string {
  const naddr = nip19.naddrEncode({ identifier: "", pubkey: linkSignerPubkey, kind: KIND.INVITE_BUNDLE, relays: [] });
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

/** Build the addressable invite bundle event template (sign with link_signer sk). */
export function buildBundleEventTemplate(bundle: InviteBundle, token: Uint8Array): {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
} {
  return {
    kind: KIND.INVITE_BUNDLE,
    content: encryptBundle(bundle, token),
    tags: [["d", ""], ["vsk", "6"]],
    created_at: Math.floor(Date.now() / 1000),
  };
}

export function buildRevocationTemplate(): { kind: number; content: string; tags: string[][]; created_at: number } {
  return { kind: KIND.INVITE_BUNDLE, content: "", tags: [["d", ""], ["vsk", "9"]], created_at: Math.floor(Date.now() / 1000) };
}
