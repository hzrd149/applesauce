// CORD-05 Invite Bundles — the URL-delivered invite: the shareable-link codec
// whose keys live in an encrypted bundle on relays. (The direct-to-npub delivery
// of the same bundle is a Direct Invite, ../helpers/direct-invite.js §6.)
//
// A link is `$BASE/invite/<naddr>#<fragment>`. The naddr is a public locator
// (kind 33301, link_signer, ""), the fragment carries the 16-byte unlock token
// plus bootstrap relays and never reaches a server. The token derives the
// bundle decrypt key; the bundle carries the community access keys. The event
// templates that anchor a link live in ../operations/invite-bundle.js.
//
// This module also owns the §1 `CommunityInvite` bundle itself — `buildInviteBundle`
// and `validateInviteBundle` — since both delivery paths (URL and Direct Invite)
// assemble and bound the same payload.

import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";
import { getCachedValue, getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { nip44 } from "applesauce-core/helpers/encryption";
import { getAddressPointerForEvent } from "applesauce-core/helpers/pointers";
import { decodePointer, naddrEncode } from "applesauce-core/helpers/pointers";
import { notifyEventUpdate } from "applesauce-core/helpers";
import { isSafeRelayURL } from "applesauce-core/helpers/relays";
import { isHexKey } from "applesauce-core/helpers/string";
import type { AddressPointer, KnownEvent, NostrEvent } from "applesauce-core/helpers";
import { communityId, inviteBundleKey } from "./crypto.js";
import type { BlobPointer, InviteBundle, JoinMaterial } from "../types.js";

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

/**
 * The single scheme/shape gate for every relay string that can reach
 * `JoinMaterial.relays` from an attacker-supplied invite — applied at every
 * boundary a stranger's bytes can carry a relay string across: the fragment
 * decode below ({@link decodeFragment}'s `lead === 0xff` and dictionary-miss
 * branches), the bundle relay rule ({@link INVITE_BUNDLE_FIELD_RULES}'s
 * `relay-list` handler), and `joinByLink`'s bootstrap-relay selection
 * (`client.ts`). A `wss://` entry survives when it also passes
 * {@link isSafeRelayURL}'s general websocket-URL shape check.
 *
 * WR-02: the plaintext-loopback carve-out this predicate used to grant
 * `ws://localhost`/`127.0.0.1`/`[::1]` has been REMOVED. After 12.3-12
 * relocated the relay gate off the app's own configured relays, all three call
 * sites above are attacker-controlled boundaries — the carve-out no longer
 * protected any trusted input, it only granted a remote invite the ability to
 * plant a loopback `ws://` endpoint that the client then dials (port probing
 * observable through `connected$`) and publishes into its own Community List.
 * An app's own local cache relay (e.g. `ws://localhost:4869`, the Phase 12.3
 * ROADMAP's motivating example) is unaffected: it is supplied as a
 * transport-only `extraRelays` entry, which this predicate never sees.
 */
export function isSafeInviteRelayURL(entry: unknown): entry is string {
  if (typeof entry !== "string") return false;
  return entry.startsWith("wss://") && isSafeRelayURL(entry);
}

export function decodeFragment(fragment: string): { token: Uint8Array; relays: string[] } {
  const bytes = base64urlnopad.decode(fragment);
  let i = 0;
  const version = bytes[i++];
  // INVITE-05/D-12: reject ANY version not exactly FRAGMENT_VERSION, not just a
  // lower one — the relay dictionary is designed to grow, so a future higher
  // version must never be decoded against today's (lower) dictionary table.
  if (version !== FRAGMENT_VERSION) throw new Error("unsupported invite fragment version");
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
  // IN-02: once the byte cursor `i` runs past the buffer, an indexed read
  // (`bytes[i++]`) yields `undefined`, `i` becomes `NaN`, and `bytes.slice(NaN,
  // NaN + 16)` silently returns an empty array — a truncated fragment would
  // otherwise only fail much later, deep inside `nip44.decrypt`, with an
  // unrelated message. Assert the token is exactly 16 bytes here, at the
  // boundary that actually produced the short slice.
  if (token.length !== 16) throw new Error("invite fragment truncated: expected a 16-byte unlock token");
  // CR-01: filter through the single isSafeInviteRelayURL predicate — not just
  // truthiness — so the lead === 0xff branch (arbitrary decoded string), the
  // lead === 0x00 host-reassembly branch, and the dictionary branch's miss-
  // yields-empty-string case are all covered by one gate before this array
  // reaches ParsedInvite.bootstrapRelays. Filtering AFTER accumulation (rather
  // than skipping entries during the decode loop above) is deliberate: the byte
  // cursor `i` must keep advancing exactly as it does today for every branch,
  // which is what keeps the trailing 16-byte token slice correctly positioned.
  return { token, relays: relays.filter(isSafeInviteRelayURL) };
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

// ── The §1 bundle: one build + one validate, shared by every invite path ─────
//
// A bundle is the same document whether it rides a link (§1) or a Direct Invite
// (§6), so both build it the same way and validate it the same way. The bundle
// is attacker-crafted input reached by following a link or unwrapping a giftwrap,
// so a client MUST bound it before use (CORD-05 §1).

/** A sane channel ceiling — a bundle carrying more is refused (CORD-05 §1). */
export const INVITE_BUNDLE_MAX_CHANNELS = 256;
/** Relay-set cap: a bundle's join-time relay snapshot is truncated (CORD-02 §6). */
export const INVITE_BUNDLE_RELAY_CAP = 5;
/**
 * Held-roots count ceiling (CR-01). `held_roots` flows unfiltered into
 * `JoinMaterial.held_roots` (`client.ts`'s `joinFromBundle`), which
 * `buildChain` (keys.ts) rebuilds into one chain element per entry (an O(N)
 * filter per element — O(N^2) total) and `syncEpochs` (sync.ts) then walks
 * with one full sequential, networked, NIP-42-authenticated epoch sync PER
 * chain element. Left uncapped, a ~40KB NIP-44-capped bundle fits roughly 800
 * entries — 800 sequential networked epoch syncs before the joining engine
 * can ever reach `phase: "live"`, across restarts.
 */
export const INVITE_BUNDLE_MAX_HELD_ROOTS = 64;
/**
 * Per-channel held-keys count ceiling (CR-01). Each `channels[].held` entry
 * costs one `channelGroupKey` X25519/ECDH derivation inside
 * `deriveChannelKeys` (keys.ts). Left uncapped, up to `INVITE_BUNDLE_MAX_CHANNELS`
 * channels each carrying an unbounded `held` array is a CPU storm on the
 * private-channel spawn path.
 */
export const INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS = 64;
/**
 * Text-length ceiling for attacker-controlled display/attribution strings
 * (CR-02): `name` (bundle-level and per-channel) and `label`/`creator_npub`
 * are all serialized into a document hard-capped at `LIST_MAX_BYTES`
 * (community-list.ts) — the bundle-level `name` TWICE per entry (`seed` and
 * `current`, via `JoinMaterial.name`). The unit is UTF-16 code units
 * (JavaScript string `.length`); the worst-case UTF-8 expansion is 4 bytes
 * per 2 code units, so the per-entry worst case stays in the low kilobytes —
 * dozens of entries still fit comfortably under the 65535-byte publish cap.
 */
export const INVITE_BUNDLE_MAX_TEXT_LENGTH = 256;
/**
 * Per-relay-entry length ceiling (D-17/CR-01). `isSafeRelayURL`'s general
 * websocket-URL shape gate (`packages/core/src/helpers/relays.ts`) delegates to
 * a regex whose path group (`[-a-zA-Z0-9()@:%_+.~#?&/=]*`) is UNBOUNDED, so a
 * multi-kilobyte `wss://a.example.com/aaaa…` entry survives the shape gate
 * intact. This cap sits BESIDE that shape gate, in the `relay-list` rule kind,
 * closing the hop the shape check alone cannot.
 */
export const INVITE_BUNDLE_MAX_RELAY_URL_LENGTH = 512;
/**
 * Whole-bundle serialized-size ceiling, in UTF-8 bytes (D-17/CR-01's
 * structural half). Per-field caps ALONE cannot bound the aggregate: up to
 * {@link INVITE_BUNDLE_MAX_CHANNELS} channels, each carrying up to
 * {@link INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS} held keys, is legal under every
 * per-field cap and still assembles into tens of kilobytes. The material a
 * bundle produces is serialized TWICE per Community-List entry (`seed` and
 * `current`, `client.ts`'s `recordJoin`) — so twice this value MUST stay inside
 * `COMMUNITY_LIST_MAX_ENTRY_BYTES` (`community-list.ts`, itself half of
 * `LIST_MAX_BYTES`). The remaining headroom (this cap is well under half of
 * that ceiling) absorbs the entry's envelope (`community_id`/`added_at`) and
 * the organic growth a later Refounding adds to `current` via `held_roots`.
 */
export const INVITE_BUNDLE_MAX_TOTAL_BYTES = 8192;

export interface BuildInviteBundleOptions {
  /** Preview name; defaults to the material's `name`. */
  name?: string;
  icon?: BlobPointer;
  /** Attribution echoed in the joiner's Guestbook Join (CORD-05 §1). */
  creator_npub?: string;
  label?: string;
  /** Optional unix-seconds expiry (D-05); past it the preview renders but joining refuses. */
  expires_at?: number;
  /** Private channels this bundle grants, by channel id. Omit to grant none. */
  channels?: string[];
}

/**
 * Assemble the §1 `CommunityInvite` bundle from the inviter's own join material.
 * The single source of truth for both the link bundle (§1) and the Direct Invite
 * bundle (§6): explicitly selected channel keys travel so the joiner can read
 * the granted Channels, and the `community_id` self-certifies the owner (§1).
 *
 * `held_roots` is deliberately NOT carried — a joiner gets the current epoch only,
 * never the history. `refounder` IS carried: without it a joiner's `foldMembers`
 * discards the epoch's Guestbook snapshot (kind 3312), which — having no prior
 * epoch to walk — is the only thing that gives them the memberlist (CORD-02 §5).
 */
export function buildInviteBundle(material: JoinMaterial, opts: BuildInviteBundleOptions = {}): InviteBundle {
  const channelIds = opts.channels ?? [];
  const channels = channelIds.map((id) => {
    const channel = material.channels.find((c) => c.id === id);
    if (!channel) throw new Error(`not a private channel we hold a key for: ${id}`);
    return {
      id: channel.id,
      key: channel.key,
      epoch: channel.epoch,
      name: channel.name,
      // Carry prior channel keys so a joiner decodes messages under earlier channel
      // epochs (a channel that was rekeyed before they joined — CORD-06).
      ...(channel.held ? { held: channel.held } : {}),
    };
  });

  const bundle: InviteBundle = {
    community_id: material.community_id,
    owner: material.owner,
    owner_salt: material.owner_salt,
    community_root: material.community_root,
    root_epoch: material.root_epoch,
    refounder: material.refounder,
    channels,
    relays: material.relays,
    name: opts.name ?? material.name,
    icon: opts.icon,
    creator_npub: opts.creator_npub,
    label: opts.label,
    expires_at: opts.expires_at,
  };
  // D-17/CR-01: fail at MINT time, not at every joiner's validator — an inviter
  // who grants a very large channel set (or a huge held-key set) otherwise
  // ships a link that `validateInviteBundle` refuses for every recipient.
  // Measured the same way the validator measures its rebuilt output.
  const bytes = new TextEncoder().encode(JSON.stringify(bundle)).length;
  if (bytes > INVITE_BUNDLE_MAX_TOTAL_BYTES)
    throw new Error(
      `invite bundle too large to mint (${bytes} bytes > ${INVITE_BUNDLE_MAX_TOTAL_BYTES}-byte cap, ${channels.length} channel(s))`,
    );
  return bundle;
}

// ── D-17: exhaustive rule tables + an allowlist rebuild ──────────────────────
//
// Three prior gap-closure rounds each bounded whatever field their author
// happened to think of and missed the next one (12.3-11 missed held_roots/
// channels[].held counts and `name` length; 12.3-12 missed `owner`,
// `owner_salt`, `refounder` and `relays[i]` length). D-17's ruling: this
// recurring defect closes STRUCTURALLY, not by adding a fifth named check.
//
// These four tables ARE `validateInviteBundle`'s contract. Each is typed as an
// exhaustive mapped type over its interface's own keys, so TypeScript refuses
// a table missing an entry — a field added to `InviteBundle`, `ChannelKey`, a
// `held_roots` entry, or `BlobPointer` with no rule fails `pnpm --filter
// applesauce-concord build`. The validated object is REBUILT from these
// tables (never spread from the input), so a field the tables do not name —
// known or not — cannot reach the output at all. A field added later without
// a rule is therefore visibly MISSING from this file, not silently covered by
// a blanket claim the way the prior "no attacker-controlled string is
// length-unbounded" comment (falsified three times) used to be.

/**
 * The bound to apply to one field. Deliberately NO escape-hatch kind exists
 * for an unbounded pass-through field — a future field that genuinely cannot
 * be bounded must force its author to add a NEW kind here, which is exactly
 * the event {@link INVITE_BUNDLE_FIELD_RULES}'s conformance suite
 * (`invite-bundle-schema.test.ts`) is built to fail on.
 */
export type BundleFieldRule =
  | { kind: "hex-key"; onInvalid: "reject" | "drop"; onAbsent: "reject" | "omit" }
  | { kind: "bounded-text"; max: number; onInvalid: "reject" | "drop"; onAbsent: "reject" | "omit" | "empty-string" }
  | { kind: "safe-integer"; onInvalid: "reject" | "drop"; onAbsent: "reject" | "omit" }
  | { kind: "relay-list"; countCap: number; urlMax: number; onInvalid: "reject"; onAbsent: "reject" }
  | { kind: "channel-list"; countCap: number; onInvalid: "reject"; onAbsent: "reject" }
  | { kind: "held-list"; countCap: number; onInvalid: "reject" | "drop"; onAbsent: "reject" | "omit" }
  | { kind: "blob-pointer"; onInvalid: "drop"; onAbsent: "omit" };

/**
 * A rule table exhaustive over every key of `T` (CR4-01). The invariant this
 * type establishes: a rule table's type parameter must ALWAYS be the type
 * actually reachable at that position of `InviteBundle` — written as an
 * indexed-access path (see the four aliases below), never as a shape
 * declared in this file. A table exhaustive over a hand-declared MIRROR of
 * the real type is exhaustive over nothing: that mirror can silently drift
 * from the real element type at `types.ts`'s `ChannelKey.held` /
 * `JoinMaterial.held_roots` positions with no build or test signal — exactly
 * the CR4-01 failure (`HELD_KEY_FIELD_RULES` used to be mapped over a local
 * `HeldRootEntry` alias that was never type-connected to either real
 * position).
 */
export type ExhaustiveBundleRules<T> = { [K in keyof Required<T>]: BundleFieldRule };

// Derived subject aliases (CR4-01): each is an INDEXED-ACCESS PATH rooted at
// `InviteBundle`, never an object literal declared in this file. A
// hand-written shape cannot be substituted for a path — the path IS the real
// position, by construction.
type BundleChannel = InviteBundle["channels"][number];
type BundleChannelHeldEntry = NonNullable<BundleChannel["held"]>[number];
type BundleHeldRootEntry = NonNullable<InviteBundle["held_roots"]>[number];
type BundleIcon = NonNullable<InviteBundle["icon"]>;

/**
 * Resolves to the literal `true` only when `Table`'s key set and `Shape`'s
 * key set are EXACTLY equal in both directions. When `Table` is missing a key
 * `Shape` has, resolves to an object naming the `missing` key(s); when
 * `Table` has an extra key `Shape` lacks, resolves to an object naming the
 * `extra` key(s) — so the compiler's own error text names the offending key.
 */
type RuleTableKeysExactly<Table, Shape> =
  Exclude<keyof Required<Shape>, keyof Table> extends never
    ? Exclude<keyof Table, keyof Required<Shape>> extends never
      ? true
      : { error: "rule table has a key its subject type does not"; extra: Exclude<keyof Table, keyof Required<Shape>> }
    : {
        error: "rule table is missing a key its subject type has";
        missing: Exclude<keyof Required<Shape>, keyof Table>;
      };

/**
 * The bundle-level table — a mapped type over EVERY key of `InviteBundle`
 * (via `Required<...>`, so an optional key still needs an entry). `InviteBundle`
 * carries no index signature, so `keyof` here is a finite, closed union — the
 * property that makes this exhaustiveness check possible at all.
 */
export const INVITE_BUNDLE_FIELD_RULES: ExhaustiveBundleRules<InviteBundle> = {
  community_id: { kind: "hex-key", onInvalid: "reject", onAbsent: "reject" },
  // owner/owner_salt are the OUTLIERS this task corrects: every other key-shaped
  // field here already goes through isHexKey, but these two only ever passed a
  // `typeof === "string"` check. The owner proof below does NOT bound them —
  // `communityId` feeds both through `hexToBytes` (no maximum length), and the
  // attacker computes the matching `community_id` themselves — so the bundle
  // self-certifies at any size without this rule.
  owner: { kind: "hex-key", onInvalid: "reject", onAbsent: "reject" },
  owner_salt: { kind: "hex-key", onInvalid: "reject", onAbsent: "reject" },
  community_root: { kind: "hex-key", onInvalid: "reject", onAbsent: "reject" },
  root_epoch: { kind: "safe-integer", onInvalid: "reject", onAbsent: "reject" },
  // Unchanged allocation bound: a non-array or over-count array rejects the
  // whole bundle; a malformed individual entry is dropped (channel-list's own
  // per-entry policy, see the walker below).
  channels: { kind: "channel-list", countCap: INVITE_BUNDLE_MAX_CHANNELS, onInvalid: "reject", onAbsent: "reject" },
  // Non-array rejects; the per-entry length cap closes isSafeRelayURL's
  // unbounded path group (CR-01) beside the existing count cap.
  relays: {
    kind: "relay-list",
    countCap: INVITE_BUNDLE_RELAY_CAP,
    urlMax: INVITE_BUNDLE_MAX_RELAY_URL_LENGTH,
    onInvalid: "reject",
    onAbsent: "reject",
  },
  // JoinMaterial.name is a REQUIRED string — it cannot be dropped to undefined
  // the way an optional field can, so an over-cap/non-string value rejects the
  // whole bundle; an ABSENT one normalizes to "" (unchanged pre-D-17 behavior).
  name: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "reject", onAbsent: "empty-string" },
  // buildInviteBundle NEVER emits held_roots (see its own doc comment) — a
  // bundle carrying one is, by definition, not one this codebase minted. A
  // non-array, an over-cap array, or an entry whose identity-bearing
  // `epoch`/`key` cannot be rebuilt rejects the WHOLE bundle rather than
  // dropping — but an entry whose `epoch`/`key` are valid and whose
  // attribution-only `refounder` is malformed is NOT rejected: it is
  // accepted with `refounder` stripped, per that field's own drop/omit
  // disposition in HELD_KEY_FIELD_RULES (WR4-02; adjudicated correct as
  // shipped — round-4 review, Adjudication 1).
  held_roots: {
    kind: "held-list",
    countCap: INVITE_BUNDLE_MAX_HELD_ROOTS,
    onInvalid: "reject",
    onAbsent: "omit",
  },
  // refounder is an event-author pubkey everywhere it is produced (keys.ts's
  // rollForward) — the pre-D-17 bare string check admitted any length. Drop
  // (not reject) on invalid: it is attribution-only, mirroring label/creator_npub.
  refounder: { kind: "hex-key", onInvalid: "drop", onAbsent: "omit" },
  label: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "drop", onAbsent: "omit" },
  creator_npub: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "drop", onAbsent: "omit" },
  // A non-number silently no-ops joinFromBundle's bare relational comparison
  // against unixNow() (IN-02) — drop rather than let a bypassable expiry stand.
  expires_at: { kind: "safe-integer", onInvalid: "drop", onAbsent: "omit" },
  // Bounds LENGTH only (via the blob table below); which URL schemes/hosts an
  // app may render remains a blob-surface policy question, still deferred.
  icon: { kind: "blob-pointer", onInvalid: "drop", onAbsent: "omit" },
};

/** The per-`channels[]`-entry table — a mapped type over every key of the
 *  real element type of `InviteBundle["channels"]` (`BundleChannel`, an
 *  indexed-access path — CR4-01). */
export const CHANNEL_KEY_FIELD_RULES: ExhaustiveBundleRules<BundleChannel> = {
  // id/key both reach hexToBytes in deriveChannelKeys (keys.ts) and are minted
  // from 32 random bytes by addChannelKey — a malformed entry is dropped (this
  // channel excluded), never rejecting every OTHER legitimate grant.
  id: { kind: "hex-key", onInvalid: "reject", onAbsent: "reject" },
  key: { kind: "hex-key", onInvalid: "reject", onAbsent: "reject" },
  epoch: { kind: "safe-integer", onInvalid: "reject", onAbsent: "reject" },
  // A channel name never enters a key derivation, but it IS carried into
  // JoinMaterial.channels and serialized into the byte-capped document, so it
  // IS length-checked. Absent-name preserves the pre-D-17 predicate's
  // observable behavior (it never rejected a channel merely for lacking a
  // name) by OMITTING the key rather than rejecting the entry or the bundle.
  name: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "reject", onAbsent: "omit" },
  // A bad `held` array invalidates the ENTRY (channel-list's own per-entry drop
  // policy then excludes this channel) — the existing per-entry policy.
  held: { kind: "held-list", countCap: INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS, onInvalid: "reject", onAbsent: "omit" },
};

/** The shared held-key-entry table (a channel's `held`, or a bundle's
 *  `held_roots`) — its subject is `BundleHeldRootEntry`, the real
 *  `held_roots[]` element type (an indexed-access path). It ALSO governs
 *  every `channels[].held[]` entry ({@link BundleChannelHeldEntry}, the real
 *  element type at that other position) — {@link RULE_TABLE_SUBJECT_PROOF}
 *  independently pins that the two share an identical key set, so one table
 *  can validly annotate both positions (CR4-01). */
export const HELD_KEY_FIELD_RULES: ExhaustiveBundleRules<BundleHeldRootEntry> = {
  epoch: { kind: "safe-integer", onInvalid: "reject", onAbsent: "reject" },
  key: { kind: "hex-key", onInvalid: "reject", onAbsent: "reject" },
  // The hop no prior round inspected at all. Drop (not reject) on invalid,
  // mirroring the top-level `refounder` field: it is attribution-only, and an
  // over-length value here does not need to sink the whole entry.
  refounder: { kind: "hex-key", onInvalid: "drop", onAbsent: "omit" },
};

/** The `icon` blob-pointer table — a mapped type over every key of
 *  `BundleIcon`, the real `InviteBundle["icon"]` type (an indexed-access
 *  path — CR4-01). All four sub-fields are length-only (`bounded-text`); a
 *  bad one drops the whole `icon` (via {@link INVITE_BUNDLE_FIELD_RULES}'s
 *  own `icon` rule), never the containing bundle. */
export const BLOB_POINTER_FIELD_RULES: ExhaustiveBundleRules<BundleIcon> = {
  url: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "reject", onAbsent: "reject" },
  key: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "reject", onAbsent: "reject" },
  nonce: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "reject", onAbsent: "reject" },
  hash: { kind: "bounded-text", max: INVITE_BUNDLE_MAX_TEXT_LENGTH, onInvalid: "reject", onAbsent: "reject" },
};

/**
 * Compile-time proof (CR4-01) that all five positions of `InviteBundle` are
 * governed by a table whose key set exactly matches the real type at that
 * position — belt to the annotations above's braces. Entries 3 and 4 are the
 * reason this proof exists at all: `HELD_KEY_FIELD_RULES` is ONE shared table
 * governing TWO real positions (`held_roots[]` and `channels[].held[]`); if a
 * future author re-inlines either position and lets it drift from the other,
 * entry 3 or entry 4 fails to resolve to `true` even though each table's own
 * single-subject annotation above is still individually satisfied. Written
 * as full indexed-access paths (not via the derived aliases above) so this
 * reads as an independent statement about the real document shape, not a
 * restatement of the annotations it is proving.
 */
export const RULE_TABLE_SUBJECT_PROOF: [
  RuleTableKeysExactly<typeof INVITE_BUNDLE_FIELD_RULES, InviteBundle>,
  RuleTableKeysExactly<typeof CHANNEL_KEY_FIELD_RULES, InviteBundle["channels"][number]>,
  RuleTableKeysExactly<typeof HELD_KEY_FIELD_RULES, NonNullable<InviteBundle["held_roots"]>[number]>,
  RuleTableKeysExactly<typeof HELD_KEY_FIELD_RULES, NonNullable<InviteBundle["channels"][number]["held"]>[number]>,
  RuleTableKeysExactly<typeof BLOB_POINTER_FIELD_RULES, NonNullable<InviteBundle["icon"]>>,
] = [true, true, true, true, true];

/** One field rule's outcome against a raw value: a value to write, an
 *  instruction to omit the key entirely, or "reject" (the containing object
 *  this rule's table governs is invalid). */
type FieldOutcome = { outcome: "value"; value: unknown } | { outcome: "omit" } | { outcome: "reject" };

/** Whether `raw` satisfies `rule`'s KIND check, and if so, the value to write —
 *  independent of `onInvalid`/`onAbsent`, which {@link applyFieldRule} applies
 *  around this. The `default` branch is load-bearing (D-17): a rule kind with
 *  no case here fails `tsc` via the `never` assignment, so a new kind can never
 *  silently validate as a no-op pass-through. */
function checkKind(rule: BundleFieldRule, raw: unknown): { valid: true; value: unknown } | { valid: false } {
  switch (rule.kind) {
    case "hex-key":
      return typeof raw === "string" && isHexKey(raw) ? { valid: true, value: raw } : { valid: false };
    case "bounded-text":
      return typeof raw === "string" && raw.length <= rule.max ? { valid: true, value: raw } : { valid: false };
    case "safe-integer":
      return typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0
        ? { valid: true, value: raw }
        : { valid: false };
    case "relay-list": {
      // Cap FIRST on the RAW array (unchanged allocation bound), then filter
      // every surviving entry through isSafeInviteRelayURL plus the new
      // per-URL length cap. Always "valid" once the shape is an array — a
      // bundle whose relays are entirely junk still validates (falls back to
      // the joining client's own default relays); dropping junk relays is not,
      // by itself, grounds to reject the whole bundle. Entries are filtered,
      // never normalized, so this stays a shape validator (D-01).
      if (!Array.isArray(raw)) return { valid: false };
      const filtered = raw
        .slice(0, rule.countCap)
        .filter((entry): entry is string => isSafeInviteRelayURL(entry) && entry.length <= rule.urlMax);
      return { valid: true, value: filtered };
    }
    case "channel-list": {
      // The count cap MUST run on the RAW array, before any per-entry
      // rebuild — a count check placed after would be defeated by an
      // over-cap array whose entries are all individually malformed
      // (direct-invite.test.ts's existing regression pins this ordering).
      if (!Array.isArray(raw)) return { valid: false };
      if (raw.length > rule.countCap) return { valid: false };
      // channel-list DROPS an invalid entry (per-entry policy) rather than
      // invalidating the whole array — one bad grant should not deny every
      // other legitimate one.
      const entries: BundleChannel[] = [];
      for (const item of raw) {
        const built = rebuildByRules<BundleChannel>(CHANNEL_KEY_FIELD_RULES, item);
        if (built) entries.push(built);
      }
      return { valid: true, value: entries };
    }
    case "held-list": {
      // Same count-before-per-entry ordering as channel-list, above.
      if (!Array.isArray(raw)) return { valid: false };
      if (raw.length > rule.countCap) return { valid: false };
      // held-list rejects the containing object when an entry's
      // identity-bearing fields (`epoch`/`key`, both reject-disposition in
      // HELD_KEY_FIELD_RULES) cannot be rebuilt — not on any malformed
      // sub-field; a drop-disposition sub-field (`refounder`) is stripped
      // from the entry instead, per that field's own rule (WR4-02). The
      // asymmetry with channel-list's per-entry-drop policy is pre-existing
      // and deliberate: a `held_roots`/`held` array whose identity cannot be
      // rebuilt is either exactly what a legitimate device produced, or it
      // is not one this codebase minted.
      const entries: BundleHeldRootEntry[] = [];
      for (const item of raw) {
        const built = rebuildByRules<BundleHeldRootEntry>(HELD_KEY_FIELD_RULES, item);
        if (!built) return { valid: false };
        entries.push(built);
      }
      return { valid: true, value: entries };
    }
    case "blob-pointer": {
      const built = rebuildByRules<BundleIcon>(BLOB_POINTER_FIELD_RULES, raw);
      return built ? { valid: true, value: built } : { valid: false };
    }
    default: {
      // Exhaustiveness guard (D-17): a new BundleFieldRule kind with no case
      // above fails `tsc` here — `rule` would not be assignable to `never`.
      const exhaustive: never = rule;
      throw new Error(`unrecognised bundle field rule kind: ${(exhaustive as BundleFieldRule).kind}`);
    }
  }
}

/** Applies one field's full rule (kind check + `onInvalid`/`onAbsent`
 *  dispositions) to a raw value, producing what {@link rebuildByRules} does
 *  with it — write the value, omit the key, or reject the containing object. */
function applyFieldRule(rule: BundleFieldRule, raw: unknown): FieldOutcome {
  if (raw === undefined) {
    switch (rule.onAbsent) {
      case "reject":
        return { outcome: "reject" };
      case "omit":
        return { outcome: "omit" };
      case "empty-string":
        return { outcome: "value", value: "" };
    }
  }
  const checked = checkKind(rule, raw);
  if (checked.valid) return { outcome: "value", value: checked.value };
  return rule.onInvalid === "reject" ? { outcome: "reject" } : { outcome: "omit" };
}

/**
 * The generic rebuild walker (D-17): given a rule table and an unknown value,
 * returns either a FRESHLY-CONSTRUCTED object containing ONLY the keys the
 * table names, or `undefined` when a reject-disposition rule fails. Two
 * properties are non-negotiable:
 *
 * - it BUILDS a new object; it never spreads its input. This is the property
 *   that makes an unknown attacker key — at any depth — unable to reach the
 *   output (CR-01's "unknown keys ride through by reference today" hole).
 * - it OMITS a field rather than assigning `undefined` to it (conditional
 *   assignment, never an object literal with a possibly-`undefined` value) —
 *   the Phase 08-06 value-hash convention: `EventStore.model()` caches on a
 *   value-based hash, and an explicit-`undefined` key changes that hash even
 *   though the JSON form is identical.
 *
 * `rules`' parameter type is deliberately the NARROW `ExhaustiveBundleRules<T>`
 * (CR4-01), not a bare `Record<string, BundleFieldRule>`: that narrowness IS
 * the enforcement — a caller cannot pass a table that is not exhaustive over
 * `T`. The one remaining erasure is the WIDENING to a `Record` for the local
 * `rules` below, contained deliberately to this single line so the walker
 * body can still iterate by string key.
 */
export function rebuildByRules<T>(rules: ExhaustiveBundleRules<T>, value: unknown): T | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const src = value as Record<string, unknown>;
  const table = rules as Record<string, BundleFieldRule>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(table)) {
    const result = applyFieldRule(table[key]!, src[key]);
    if (result.outcome === "reject") return undefined;
    if (result.outcome === "value") out[key] = result.value;
    // "omit": write nothing — never `out[key] = undefined`.
  }
  return out as T;
}

/**
 * Bound and self-certify an attacker-crafted bundle (CORD-05 §1, D-17). Walks
 * {@link INVITE_BUNDLE_FIELD_RULES} to rebuild the bundle (every field bounded
 * or stripped by construction — see {@link rebuildByRules}), then applies the
 * two cross-field checks a per-field rule cannot express: the owner proof
 * (`community_id == sha256(owner || salt)`, CORD-02) and the aggregate
 * serialized-size cap (CR-01's structural half — per-field caps alone cannot
 * bound the total: up to `INVITE_BUNDLE_MAX_CHANNELS` channels each carrying
 * up to `INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS` held keys is legal under every
 * per-field cap and still assembles into tens of kilobytes). Returns the
 * rebuilt object, or `undefined` if the bundle is unusable.
 *
 * The return is now DIRECTLY typed as `InviteBundle` — no terminal assertion.
 * The remaining single erasure lives inside {@link rebuildByRules} (its
 * narrow-parameter/wide-local widening), and the enforcement that this
 * function's contract is sound is threefold (CR4-01): the mapped-type
 * tables above (a field with no rule fails `tsc`), {@link
 * RULE_TABLE_SUBJECT_PROOF} (a table whose key set has drifted from the
 * real position it governs fails `tsc`), and the conformance suite
 * (`invite-bundle-schema.test.ts` — a rule that does not actually bound its
 * field, or a table governed by a hand-declared shape, fails a test). Do not
 * "fix" this design by reintroducing a hand-written field-by-field literal —
 * that literal is the defect D-17/CR4-01 exist to remove.
 */
export function validateInviteBundle(bundle: InviteBundle | undefined): InviteBundle | undefined {
  if (!bundle || typeof bundle !== "object") return undefined;
  const rebuilt = rebuildByRules<InviteBundle>(INVITE_BUNDLE_FIELD_RULES, bundle);
  if (!rebuilt) return undefined;
  // Owner proof: community_id == sha256(owner || salt) (CORD-02). Both
  // operands are already known to be exactly-64-char hex (the `hex-key` rule
  // above), so `hexToBytes` cannot throw here — the try/catch is defense in
  // depth only.
  let expected: string;
  try {
    expected = bytesToHex(communityId(rebuilt.owner, hexToBytes(rebuilt.owner_salt)));
  } catch {
    return undefined;
  }
  if (expected !== rebuilt.community_id) return undefined;
  // Aggregate size cap (CR-01's structural half), measured on the REBUILT
  // object — never on the untrusted input, which the walk above may have
  // already shrunk (junk relays filtered, unknown keys stripped).
  const bytes = new TextEncoder().encode(JSON.stringify(rebuilt)).length;
  if (bytes > INVITE_BUNDLE_MAX_TOTAL_BYTES) return undefined;
  return rebuilt;
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

/**
 * The bundle's `vsk` edition tag. Absent defaults to live (CORD-05 §1); present
 * but unparseable (D-04) denies rather than defaulting to live — mirrors
 * `hasMalformedMs`'s absent-vs-malformed two-branch shape (helpers/stream.ts).
 * `Number("junk")` -> `NaN` used to fall through as a value that never equaled
 * `INVITE_BUNDLE_VSK_REVOKED`, staying live; this closes that revocation-bypass
 * hole by returning `INVITE_BUNDLE_VSK_REVOKED` directly so the existing
 * `=== INVITE_BUNDLE_VSK_REVOKED` predicate in {@link isInviteBundleRevoked}
 * denies it. A clean numeric non-vocabulary value (e.g. `7`) is neither
 * malformed nor `9` and stays joinable, unaffected by this branch.
 */
export function getInviteBundleVsk(event: NostrEvent): number {
  const raw = event.tags.find((t) => t[0] === "vsk")?.[1];
  if (raw === undefined) return INVITE_BUNDLE_VSK_LIVE;
  const n = Number(raw);
  return Number.isNaN(n) ? INVITE_BUNDLE_VSK_REVOKED : n;
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
