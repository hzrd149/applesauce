// CORD-05 §4 Invite List (kind 13303) — merge + liveness semantics.
//
// A creator's minted links sync across their devices/clients as one
// self-encrypted replaceable event. The token is the merge key: an entry is
// immutable once minted, tombstones union, and a tombstone always beats an
// entry TERMINALLY — a stale device can never resurrect a revoked link. This is
// simpler than the Community List (CORD-02 §8), whose leaves can be undone by a
// later re-join; here a revocation is forever.
//
// There is no combined "document" type: invites and tombstones are two separate
// arrays that the cast/factory manage independently.

import { hexToBytes } from "@noble/hashes/utils.js";
import {
  getHiddenContent,
  getOrComputeCachedValue,
  isHiddenContentUnlocked,
  KnownEvent,
  notifyEventUpdate,
  unlockHiddenContent,
  type AddressPointer,
  type HiddenContentSigner,
  type NostrEvent,
} from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";

import type { InviteListInvite, InviteListTombstone } from "../types.js";
import { INVITE_BUNDLE_KIND, parseInviteLink } from "./invite.js";

/** Concord invite list kind (CORD-05 §4). */
export const INVITE_LIST_KIND = 13303;

/** The NIP-44 plaintext cap the serialized list must fit under (CORD-02 §8, shared constant). */
export const INVITE_LIST_MAX_BYTES = 65_535;

/**
 * Whether an invite link is live: it has an entry and no tombstone (CORD-05 §4).
 * A tombstone is terminal — unlike a Community List leave, a revoked link never
 * resurrects.
 */
export function isInviteLive(invites: InviteListInvite[], tombstones: InviteListTombstone[], token: string): boolean {
  if (tombstones.some((t) => t?.token === token)) return false;
  return invites.some((e) => e?.token === token);
}

/** The live invite links, derived (deduped by token, tombstoned links removed). */
export function liveInviteEntries(invites: InviteListInvite[], tombstones: InviteListTombstone[]): InviteListInvite[] {
  const live = new Map<string, InviteListInvite>();
  for (const e of invites) {
    if (!e?.token || live.has(e.token) || !isInviteLive(invites, tombstones, e.token)) continue;
    live.set(e.token, e);
  }
  return [...live.values()];
}

/**
 * Deterministically merge two arrays of invite entries — commutative,
 * idempotent, nothing deleted. The token is the merge key and an entry is
 * immutable once minted (first seen wins) (CORD-05 §4).
 */
export function mergeInvites(a: InviteListInvite[], b: InviteListInvite[]): InviteListInvite[] {
  const entries = new Map<string, InviteListInvite>();
  for (const e of [...a, ...b]) {
    if (!e || typeof e.token !== "string" || entries.has(e.token)) continue;
    entries.set(e.token, e);
  }
  return [...entries.values()].sort((x, y) => x.token.localeCompare(y.token));
}

/** Deterministically union two arrays of tombstones by token (commutative, idempotent). */
export function mergeTombstones(a: InviteListTombstone[], b: InviteListTombstone[]): InviteListTombstone[] {
  const tombstones = new Map<string, InviteListTombstone>();
  for (const t of [...a, ...b]) {
    if (!t || typeof t.token !== "string" || tombstones.has(t.token)) continue;
    tombstones.set(t.token, t);
  }
  return [...tombstones.values()].sort((x, y) => x.token.localeCompare(y.token));
}

/**
 * The atomic link mutations (mint/revoke) live as composable
 * `InviteListOperation`s in ../operations/invite-list.js; they are built on the
 * `mergeInvites`/`mergeTombstones` primitives above.
 */

/** Whether the serialized (JSON) list fits under the NIP-44 plaintext cap. */
export function inviteListWithinByteCap(invites: InviteListInvite[], tombstones: InviteListTombstone[]): boolean {
  const bytes = new TextEncoder().encode(JSON.stringify({ entries: invites, tombstones }));
  return bytes.length <= INVITE_LIST_MAX_BYTES;
}

// ── Event-level helpers (self-encrypted list; hidden-content family) ─────────

/** A validated Concord Invite List event (kind 13303). */
export type InviteListEvent = KnownEvent<typeof INVITE_LIST_KIND>;

/** Validates that an event is a Concord invite list (kind 13303). */
export function isValidInviteList(event: NostrEvent): event is InviteListEvent {
  return event.kind === INVITE_LIST_KIND;
}

/** Symbol for caching the parsed (decrypted) invite list on an event. */
export const InviteListSymbol = Symbol.for("concord-invite-list");

/** The decrypted invite list split into its two independent arrays. */
export interface ParsedInviteList {
  invites: InviteListInvite[];
  tombstones: InviteListTombstone[];
}

/**
 * Parse the self-encrypted invite list JSON into its two arrays (empty on
 * absent/blank). The stored document keys the entries as `entries`; the parsed
 * object exposes them as `invites`.
 */
export function parseInviteList(json: string | undefined): ParsedInviteList {
  if (!json) return { invites: [], tombstones: [] };
  const doc = JSON.parse(json) as { entries?: InviteListInvite[]; tombstones?: InviteListTombstone[] };
  return { invites: doc.entries ?? [], tombstones: doc.tombstones ?? [] };
}

/** Whether the self-encrypted invite list plaintext is unlocked on the event. */
export function isInviteListUnlocked(event: NostrEvent): boolean {
  return isHiddenContentUnlocked(event);
}

/** Returns the parsed invite list if the event has been unlocked, otherwise undefined. */
export function getInviteList(event: NostrEvent): ParsedInviteList | undefined {
  const json = getHiddenContent(event);
  if (json === undefined) return undefined;
  return getOrComputeCachedValue(event, InviteListSymbol, () => parseInviteList(json));
}

/** The live invite links derived from the unlocked list, or undefined if locked. */
export function getLiveInvites(event: NostrEvent): InviteListInvite[] | undefined {
  const parsed = getInviteList(event);
  return parsed && liveInviteEntries(parsed.invites, parsed.tombstones);
}

/**
 * The address pointer locating an invite entry's bundle event (kind 33301,
 * `link_signer`, `""`). The author is derived from the entry's stored
 * `signer_sk`; the link's bootstrap relays are attached as loader hints when the
 * stored `url` parses.
 */
export function getInviteBundleLocator(invite: InviteListInvite): AddressPointer {
  let relays: string[] | undefined;
  try {
    relays = parseInviteLink(invite.url).bootstrapRelays;
  } catch {
    relays = undefined;
  }
  return {
    kind: INVITE_BUNDLE_KIND,
    pubkey: getPublicKey(hexToBytes(invite.signer_sk)),
    identifier: "",
    relays,
  };
}

/** Unlocks and parses the self-encrypted invite list using the owning user's signer. */
export async function unlockInviteList(event: NostrEvent, signer: HiddenContentSigner): Promise<ParsedInviteList> {
  if (!isInviteListUnlocked(event)) {
    await unlockHiddenContent(event, signer);
    notifyEventUpdate(event);
  }
  return getInviteList(event) ?? { invites: [], tombstones: [] };
}
