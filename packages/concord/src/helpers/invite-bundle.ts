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
import type { BlobPointer, ChannelKey, InviteBundle, JoinMaterial } from "../types.js";

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
 * WR-01 loopback carve-out for {@link isSafeInviteRelayURL}: `ws://` (plaintext)
 * is refused everywhere EXCEPT when the host is loopback — `localhost`,
 * `127.0.0.1`, or `[::1]`, each optionally followed by `:port` and/or a path.
 * Kept as an anchored regex constant (not inlined in the predicate body) so the
 * carve-out's shape is independently reviewable.
 */
const LOOPBACK_PLAINTEXT_WS = /^ws:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/[-a-zA-Z0-9()@:%_+.~#?&/=]*)?$/;

/**
 * The single scheme/shape gate for every relay string that can reach
 * `JoinMaterial.relays` from an attacker-supplied invite — applied at BOTH
 * boundaries a stranger's bytes can carry a relay string across: the fragment
 * decode below ({@link decodeFragment}'s `lead === 0xff` and dictionary-miss
 * branches, CR-01) and the bundle relay filter ({@link validateInviteBundle},
 * CR-02's neighbour). A `wss://` entry survives when it also passes
 * {@link isSafeRelayURL}'s general websocket-URL shape check. The plaintext
 * scheme (`ws://`) is refused UNLESS the host is loopback (WR-01) — checked via
 * the anchored {@link LOOPBACK_PLAINTEXT_WS} regex independently of
 * `isSafeRelayURL`, since that general check's hostname pattern does not accept
 * the bracketed IPv6 loopback literal (`[::1]`) this carve-out must admit.
 * The loopback carve-out exists because this project's own local cache-relay
 * form (`ws://localhost:4869`, the Phase 12.3 ROADMAP's motivating example) has
 * no network observer to protect against, whereas a REMOTE plaintext relay
 * would expose stream pubkeys, subscription filters, connection metadata, and
 * the NIP-42 challenge/response flow to anyone on the wire — even though
 * Concord's own payloads are themselves encrypted.
 */
export function isSafeInviteRelayURL(entry: unknown): entry is string {
  if (typeof entry !== "string") return false;
  if (LOOPBACK_PLAINTEXT_WS.test(entry)) return true;
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

  return {
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
}

/**
 * Shape-checks one `held` key entry (a channel's held prior key, or a bundle's
 * `held_roots` entry) — both are `{epoch, key}`-shaped and both feed a
 * `hexToBytes(key)` call inside `deriveChannelKeys` (CR-02).
 */
function isValidHeldKeyEntry(h: unknown): h is { epoch: number; key: string } {
  if (typeof h !== "object" || h === null) return false;
  const entry = h as Record<string, unknown>;
  return (
    typeof entry.key === "string" &&
    isHexKey(entry.key) &&
    typeof entry.epoch === "number" &&
    Number.isSafeInteger(entry.epoch) &&
    entry.epoch >= 0
  );
}

/**
 * Shape-validates one `channels[]` entry (CR-02): `id`/`key` must be 64-char
 * hex — both reach `hexToBytes` in `deriveChannelKeys` (keys.ts), and
 * `addChannelKey` mints both from 32 random bytes — and `epoch` must be a
 * non-negative safe integer (it feeds `channel.epoch + 1` arithmetic). The
 * optional `held` array, when present, is validated the same way per entry.
 * `name` is intentionally left unvalidated: it is display-only, never enters a
 * key derivation, and coercing it here would turn this shape validator into a
 * rewriter of protocol state (D-01). A malformed entry is DROPPED by the
 * caller (this channel is excluded from the validated bundle) rather than
 * rejecting the whole bundle — mirroring the relay filter's existing
 * precedent below: one bad grant should not deny every other legitimate one.
 */
function isValidChannelEntry(c: unknown): c is ChannelKey {
  if (typeof c !== "object" || c === null) return false;
  const entry = c as Record<string, unknown>;
  if (typeof entry.id !== "string" || !isHexKey(entry.id)) return false;
  if (typeof entry.key !== "string" || !isHexKey(entry.key)) return false;
  if (typeof entry.epoch !== "number" || !Number.isSafeInteger(entry.epoch) || entry.epoch < 0) return false;
  if (entry.held !== undefined && (!Array.isArray(entry.held) || !entry.held.every(isValidHeldKeyEntry))) return false;
  return true;
}

/**
 * Bound and self-certify an attacker-crafted bundle (CORD-05 §1): the `owner`
 * and `owner_salt` MUST reproduce the `community_id`; `community_root` must be
 * 64-char hex and `root_epoch` a non-negative safe integer — both reach
 * `baseKeysFor`'s `hexToBytes`/epoch arithmetic (keys.ts:128-140), so a
 * malformed value here would otherwise throw synchronously deep inside key
 * derivation instead of being refused at this boundary (CR-02). The channel
 * count is capped (on the RAW array) to refuse an unbounded-allocation link,
 * and each surviving `channels[]` entry — id/key/epoch, and any `held` keys —
 * is shape-checked the same way. An optional `held_roots` is validated
 * identically when present; `buildInviteBundle` never emits that field, so a
 * malformed one rejects the WHOLE bundle rather than being dropped. The relay
 * snapshot is truncated to the Community's cap and filtered through the
 * single {@link isSafeInviteRelayURL} predicate (CR-01/WR-01). After this
 * function returns a bundle, no field that reaches a `hexToBytes` call or an
 * arithmetic epoch expression can be malformed. Returns a normalized copy, or
 * `undefined` if the bundle is unusable. `expires_at` is NOT checked here —
 * past expiry the preview still renders, only joining refuses (that check
 * belongs at join time).
 */
export function validateInviteBundle(bundle: InviteBundle | undefined): InviteBundle | undefined {
  if (!bundle || typeof bundle !== "object") return undefined;
  if (typeof bundle.owner !== "string" || typeof bundle.owner_salt !== "string") return undefined;
  // Owner proof: community_id == sha256(owner || salt) (CORD-02).
  let expected: string;
  try {
    expected = bytesToHex(communityId(bundle.owner, hexToBytes(bundle.owner_salt)));
  } catch {
    return undefined;
  }
  if (expected !== bundle.community_id) return undefined;
  // CR-02: community_root/root_epoch both reach baseKeysFor's hexToBytes/epoch
  // arithmetic — malformed here throws synchronously deep inside key
  // derivation instead of being refused at the boundary. Checked immediately
  // after the owner proof and before any array method runs, so the "shape must
  // be validated BEFORE any array method touches it" ordering below stays
  // accurate for every field this function bounds.
  if (typeof bundle.community_root !== "string" || !isHexKey(bundle.community_root)) return undefined;
  if (typeof bundle.root_epoch !== "number" || !Number.isSafeInteger(bundle.root_epoch) || bundle.root_epoch < 0)
    return undefined;
  // INVITE-02/D-10: shape must be validated BEFORE any array method touches it —
  // same guard-before-array-method ordering as AUTH-04 (control.ts). A non-array
  // `channels` (e.g. `{a:1}`) would otherwise bypass the length cap below, and a
  // string `relays` would emerge from `.slice()` as a substring typed `string[]`.
  if (!Array.isArray(bundle.channels) || !Array.isArray(bundle.relays)) return undefined;
  // CR-02: the cap MUST run on the RAW array, before any per-entry filtering —
  // it is the allocation bound the cap exists to enforce, and an existing test
  // (direct-invite.test.ts) supplies an over-cap array whose entries are ALL
  // malformed and requires the whole bundle to be rejected; filtering first
  // would empty that array below the cap and let the bundle validate. Do not
  // "simplify" this ordering later.
  if (bundle.channels.length > INVITE_BUNDLE_MAX_CHANNELS) return undefined;
  const channels = bundle.channels.filter(isValidChannelEntry);
  // CR-02: `held_roots` is validated the same way as a channel's `held` keys,
  // but `buildInviteBundle` deliberately never emits this field (see its own
  // doc comment) — a bundle carrying one is, by definition, not one we minted,
  // so a malformed entry rejects the WHOLE bundle rather than being dropped.
  if (
    bundle.held_roots !== undefined &&
    (!Array.isArray(bundle.held_roots) || !bundle.held_roots.every(isValidHeldKeyEntry))
  )
    return undefined;
  // T-12.3-09-04/CR-01: cap FIRST (unchanged allocation bound), then filter
  // every entry through the single isSafeInviteRelayURL predicate — the shared
  // scheme/shape gate applied at every boundary a stranger's relay string can
  // reach JoinMaterial.relays from (see its doc comment for the other call
  // site, decodeFragment). This array flows into `JoinMaterial.relays` and from
  // there into the refounding quorum's protocol set (community.ts's `refound()`)
  // — a security-critical operation — so an unvalidated entry (non-string, junk
  // string, non-websocket scheme, or a remote plaintext scheme) is attacker-
  // reachable input and must never survive. A bundle whose relays are entirely
  // junk still validates (falls back to the joining client's own default
  // relays); dropping junk relays is not, by itself, grounds to reject the
  // whole bundle. Entries are NOT normalized here — only filtered — so this
  // function stays a shape validator, not a rewriter of protocol state (D-01).
  const relays = bundle.relays.slice(0, INVITE_BUNDLE_RELAY_CAP).filter(isSafeInviteRelayURL);
  // A non-string `refounder` would gate the snapshot fold on a junk comparison; drop it.
  const refounder = typeof bundle.refounder === "string" ? bundle.refounder : undefined;
  return { ...bundle, channels, relays, refounder };
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
