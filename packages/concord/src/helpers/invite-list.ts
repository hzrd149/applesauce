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
import { isHexKey } from "applesauce-core/helpers/string";

import type { InviteListInvite, InviteListTombstone } from "../types.js";
import { INVITE_BUNDLE_KIND, parseInviteLink } from "./invite-bundle.js";

/** Concord invite list kind (CORD-05 §4). */
export const INVITE_LIST_KIND = 13303;

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

// ── Event-level helpers (self-encrypted list; hidden-content family) ─────────

/** A validated Concord Invite List event (kind 13303). */
export type InviteListEvent = KnownEvent<typeof INVITE_LIST_KIND>;

/** Validates that an event is a Concord invite list (kind 13303). */
export function isValidInviteList(event: NostrEvent): event is InviteListEvent {
  return event.kind === INVITE_LIST_KIND;
}

/** Symbol for caching the parsed (decrypted) invite list on an event. */
export const InviteListSymbol = Symbol.for("concord-invite-list");

/**
 * The decrypted invite list document — the parsed value IS the wire
 * document, not a reconstruction of it. `entries` and `tombstones` are
 * guaranteed present (defaulted to `[]` when absent), and every other
 * top-level key the JSON carried is preserved verbatim on the returned
 * object via the index signature below — the same open-object idiom
 * {@link InviteListInvite} and {@link InviteListTombstone} already use one
 * level down in `types.ts`. CORD-05 §4 restates CORD-02 §6's round-trip
 * MUST for this document; a named carrier field for "the rest" would keep
 * the reconstruction and rely on every future write site remembering to
 * spread it, which D-12 rejected as an enumerated patch rather than a
 * structural fix (D-01/D-12).
 */
export interface ParsedInviteList {
  entries: InviteListInvite[];
  tombstones: InviteListTombstone[];
  [k: string]: unknown;
}

export const INVITE_LIST_INVITE_FIELDS = [
  "token",
  "signer_sk",
  "community_id",
  "url",
  "label",
  "channels",
  "created_at",
  "expires_at",
] as const satisfies readonly (keyof InviteListInvite)[];

export type InviteListInviteField = (typeof INVITE_LIST_INVITE_FIELDS)[number];

export type InviteListInviteValidation =
  | { ok: true; value: InviteListInvite }
  | { ok: false; field: InviteListInviteField; reason: "missing" | "invalid" };

const TOKEN_HEX = /^[0-9a-f]{32}$/i;

/** Validate one persisted entry and rebuild only its declared trusted fields. */
export function validateInviteListInvite(raw: unknown): InviteListInviteValidation {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, field: "token", reason: "missing" };
  }
  const value = raw as Record<string, unknown>;
  const required: Array<[InviteListInviteField, (candidate: unknown) => boolean]> = [
    ["token", (candidate) => typeof candidate === "string" && TOKEN_HEX.test(candidate)],
    ["signer_sk", (candidate) => typeof candidate === "string" && isHexKey(candidate)],
    ["community_id", (candidate) => typeof candidate === "string" && isHexKey(candidate)],
    [
      "url",
      (candidate) => {
        if (typeof candidate !== "string") return false;
        try {
          parseInviteLink(candidate);
          return true;
        } catch {
          return false;
        }
      },
    ],
    ["created_at", (candidate) => typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0],
  ];
  for (const [field, accepts] of required) {
    if (value[field] === undefined) return { ok: false, field, reason: "missing" };
    if (!accepts(value[field])) return { ok: false, field, reason: "invalid" };
  }
  if (value.label !== undefined && typeof value.label !== "string") {
    return { ok: false, field: "label", reason: "invalid" };
  }
  if (value.channels !== undefined && (!Array.isArray(value.channels) || !value.channels.every(isHexKey))) {
    return { ok: false, field: "channels", reason: "invalid" };
  }
  if (
    value.expires_at !== undefined &&
    (typeof value.expires_at !== "number" || !Number.isSafeInteger(value.expires_at) || value.expires_at < 0)
  ) {
    return { ok: false, field: "expires_at", reason: "invalid" };
  }

  const result: InviteListInvite = {
    token: value.token as string,
    signer_sk: value.signer_sk as string,
    community_id: value.community_id as string,
    url: value.url as string,
    created_at: value.created_at as number,
  };
  if (value.label !== undefined) result.label = value.label as string;
  if (value.channels !== undefined) result.channels = value.channels as string[];
  if (value.expires_at !== undefined) result.expires_at = value.expires_at as number;
  return { ok: true, value: result };
}

/**
 * Parse the self-encrypted invite list JSON into the open wire document
 * (empty arrays on absent/blank). The returned value is the parsed document
 * spread as-is, with only `entries` and `tombstones` defaulted to `[]` when
 * absent — every other top-level key present in the JSON survives unmodified
 * (D-01/D-12).
 */
export function parseInviteList(json: string | undefined): ParsedInviteList {
  if (!json) return { entries: [], tombstones: [] };
  const doc = JSON.parse(json) as ParsedInviteList;
  return { ...doc, entries: doc.entries ?? [], tombstones: doc.tombstones ?? [] };
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
  return parsed && liveInviteEntries(parsed.entries, parsed.tombstones);
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
  return getInviteList(event) ?? { entries: [], tombstones: [] };
}
