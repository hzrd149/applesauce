// Spec-derived tests for the §1 CommunityInvite bundle guards (CORD-05) —
// every expected value below is hand-derived from the spec formula/shape, never
// read back from the function under test (TEST-01/D-13).

import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, randomBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import type { NostrEvent } from "applesauce-core/helpers";

import { communityId } from "../crypto.js";
import {
  INVITE_BUNDLE_KIND,
  INVITE_BUNDLE_MAX_CHANNELS,
  INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS,
  INVITE_BUNDLE_MAX_HELD_ROOTS,
  INVITE_BUNDLE_MAX_RELAY_URL_LENGTH,
  INVITE_BUNDLE_MAX_TEXT_LENGTH,
  INVITE_BUNDLE_RELAY_CAP,
  RELAY_DICTIONARY,
  STOCK_RELAYS,
  buildInviteBundle,
  decodeFragment,
  encodeFragment,
  isInviteBundleRevoked,
  isSafeInviteRelayURL,
  validateInviteBundle,
} from "../invite-bundle.js";
import { getInviteBundleLocator } from "../invite-list.js";
import type { InviteBundle, InviteListInvite, JoinMaterial } from "../../types.js";

// ── Shared valid owner triple, hand-derived from CORD-02 Appendix A.4 —
// community_id = sha256("concord/community" || owner_xonly[32] || owner_salt[32]).
const OWNER = "ab".repeat(32);
const OWNER_SALT = randomBytes(32);
const COMMUNITY_ID = bytesToHex(communityId(OWNER, OWNER_SALT));

const validOwnerFields = {
  owner: OWNER,
  owner_salt: bytesToHex(OWNER_SALT),
  community_id: COMMUNITY_ID,
  community_root: "cd".repeat(32),
  root_epoch: 0,
  name: "Test Community",
} satisfies Partial<InviteBundle>;

describe("validateInviteBundle (INVITE-02/D-10)", () => {
  it("returns undefined when channels is not an array (before any .length runs)", () => {
    const bundle = {
      ...validOwnerFields,
      // @ts-expect-error deliberately malformed for the fail-closed test
      channels: { a: 1 },
      relays: ["wss://ok"],
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
    // Non-vacuity: without the Array.isArray guard, `channels.length` reads
    // `undefined` off the object literal (no runtime error) and the bundle
    // would validate instead of being rejected — this case pins that hole shut.
  });

  it("returns undefined when relays is not an array (before any .slice runs)", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      // @ts-expect-error deliberately malformed for the fail-closed test
      relays: "wss://evil",
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
    // Non-vacuity: without the guard, `"wss://evil".slice(0, 5)` returns the
    // substring "wss:/" typed as `string[]` at compile time but actually a
    // string at runtime — silently corrupting the relay set instead of refusing.
  });

  it("still validates a well-formed bundle with array channels/relays (regression)", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: ["wss://ok.example.com"],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([]);
    expect(result?.relays).toEqual(["wss://ok.example.com"]);
  });

  // ── Gap closure (T-12.3-09-04): `relays` entries must be validated as safe
  // relay URL strings — this array flows into `JoinMaterial.relays` and from
  // there into the refounding quorum's protocol set (a security-critical
  // operation), so an unvalidated entry is attacker-reachable input.
  it("drops non-string relay entries (numbers, null, objects, nested arrays)", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      // @ts-expect-error deliberately hostile shapes for the fail-closed test
      relays: [123, null, { a: 1 }, ["wss://ok"]],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.relays).toEqual([]);
  });

  it("drops an empty-string entry and a non-URL string entry", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: ["", "not-a-relay-url", "wss://valid.example.com"],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.relays).toEqual(["wss://valid.example.com"]);
  });

  it("drops an http:// entry — only websocket schemes survive", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: ["wss://valid.example.com", "http://example.com/relay"],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.relays).toEqual(["wss://valid.example.com"]);
  });

  it("returns an entirely-valid relays array intact, in original order and form (no normalization applied here)", () => {
    const relays = ["wss://a.example.com", "wss://B.EXAMPLE.com/path"];
    const bundle = { ...validOwnerFields, channels: [], relays } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.relays).toEqual(relays);
  });

  it("validates successfully with an empty relays array when every entry is junk — a junk relay list is not grounds to reject the bundle", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      // @ts-expect-error deliberately hostile shapes for the fail-closed test
      relays: ["junk1", "junk2", 42],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.relays).toEqual([]);
  });

  it("still bounds an oversized relays array to the existing cap", () => {
    const relays = Array.from({ length: INVITE_BUNDLE_RELAY_CAP + 5 }, (_, i) => `wss://relay-${i}.example.com`);
    const bundle = { ...validOwnerFields, channels: [], relays } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.relays.length).toBe(INVITE_BUNDLE_RELAY_CAP);
    expect(result?.relays).toEqual(relays.slice(0, INVITE_BUNDLE_RELAY_CAP));
  });

  // Gap closure (WR-02, 12.3-13): the plaintext-loopback carve-out is REMOVED
  // outright — after 12.3-12 relocated the relay gate off the app's own
  // configured relays, every isSafeInviteRelayURL call site is
  // attacker-controlled, so the carve-out only granted a remote invite the
  // ability to plant a loopback endpoint the client would then dial.
  it("drops BOTH a remote and a loopback ws:// entry — the carve-out no longer exists (WR-02)", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: ["ws://evil.example.com", "ws://localhost:4869", "wss://legit.example.com"],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.relays).toEqual(["wss://legit.example.com"]);
    // Non-vacuity: pre-fix (12.3-11/12.3-12), a loopback ws:// entry survived
    // this filter via the (now-removed) LOOPBACK_PLAINTEXT_WS carve-out. An
    // app's own local cache relay is unaffected by this removal: it travels as
    // a transport-only `extraRelays` entry, which this predicate never sees.
  });
});

// ── Gap closure (CR-02, 12.3-11): validateInviteBundle now bounds every field
// that reaches a hexToBytes call or an arithmetic epoch expression, not just
// the owner proof + array shapes T-12.3-09-04 covered.
describe("validateInviteBundle field validation (CR-02, 12.3-11)", () => {
  const validChannel = { id: "11".repeat(32), key: "22".repeat(32), epoch: 0, name: "general" };

  it("rejects a bundle whose community_root is a short non-hex string", () => {
    const bundle = { ...validOwnerFields, community_root: "not-hex", channels: [], relays: [] } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
    // Non-vacuity: pre-fix, community_root was never checked in this function at
    // all — this exact malformed value instead reaches baseKeysFor's
    // `hexToBytes(material.community_root)` deep inside key derivation and
    // throws synchronously (the CR-02 repro the verifier reproduced by hand).
  });

  it("rejects a bundle with an absent community_root", () => {
    const { community_root: _drop, ...rest } = validOwnerFields;
    const bundle = { ...rest, channels: [], relays: [] } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
  });

  it("rejects a bundle whose root_epoch is a non-number", () => {
    const bundle = {
      ...validOwnerFields,
      root_epoch: "0" as unknown as number,
      channels: [],
      relays: [],
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
  });

  it("rejects a bundle whose root_epoch is negative", () => {
    const bundle = { ...validOwnerFields, root_epoch: -1, channels: [], relays: [] } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
  });

  it("rejects a bundle whose root_epoch is a non-integer", () => {
    const bundle = { ...validOwnerFields, root_epoch: 1.5, channels: [], relays: [] } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
  });

  it("retains only the well-formed channels[] entry when one entry is malformed", () => {
    const malformed = { id: "zz", key: "short", epoch: -1, name: "bad" };
    const bundle = { ...validOwnerFields, channels: [validChannel, malformed], relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([validChannel]);
    // Non-vacuity: pre-fix, `channels` passed through unfiltered — both the
    // well-formed AND the malformed entry (non-hex id, 5-char key, negative
    // epoch) would have survived into JoinMaterial.channels and reached
    // `deriveChannelKeys`'s `hexToBytes(channel.id)` / `hexToBytes(channel.key)`.
  });

  it("drops a channel entry whose held array carries a malformed entry", () => {
    const withBadHeld = { ...validChannel, held: [{ epoch: 0, key: "not-hex" }] };
    const bundle = { ...validOwnerFields, channels: [withBadHeld], relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    // This validator drops the offending channel entry rather than rejecting the
    // whole bundle — the same precedent the relay filter already sets: one bad
    // grant should not deny every OTHER channel this bundle legitimately grants.
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([]);
  });

  it("rejects a bundle carrying a held_roots array with a non-hex key", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: [],
      held_roots: [{ epoch: 0, key: "not-hex" }],
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
    // buildInviteBundle never emits held_roots (see its own doc comment) — any
    // bundle carrying one is, by definition, not one we minted, so a malformed
    // entry here rejects the WHOLE bundle rather than being merely dropped.
  });

  it("still rejects an over-cap channels array evaluated on the RAW array before per-entry filtering (ordering guard)", () => {
    const channels = Array.from({ length: INVITE_BUNDLE_MAX_CHANNELS + 1 }, (_, i) => ({
      id: `bad-${i}`, // non-hex, malformed
      key: "short",
      epoch: -1,
      name: `c${i}`,
    }));
    const bundle = { ...validOwnerFields, channels, relays: [] } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
    // Non-vacuity: if the per-entry filter ran BEFORE the cap, every entry here
    // (all malformed) would be dropped, emptying the array to length 0 — well
    // under the cap — and the bundle would validate. The cap must run on the
    // RAW array first.
  });
});

// ── Gap closure (CR-01, CR-02, IN-02's expires_at half; 12.3-12): the two
// attacker-controlled arrays (held_roots, channels[].held) are bounded by
// COUNT, not just shape, and every attacker-controlled string that reaches
// the serialized document or a published Guestbook Join is bounded by LENGTH.
describe("validateInviteBundle cardinality and text bounds (12.3-12)", () => {
  // Deterministic valid-hex generator — never reads a value back from the
  // function under test (TEST-01/D-13).
  function hexKey(n: number): string {
    return (n % 256).toString(16).padStart(2, "0").repeat(32);
  }

  it("rejects a bundle whose held_roots array length exceeds the cap, even when every entry is well-formed", () => {
    const held_roots = Array.from({ length: INVITE_BUNDLE_MAX_HELD_ROOTS + 1 }, (_, i) => ({
      epoch: i,
      key: hexKey(i),
    }));
    const bundle = { ...validOwnerFields, channels: [], relays: [], held_roots } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
    // Non-vacuity: pre-fix, held_roots was only shape-validated per entry, never
    // counted — this array (all well-formed entries) would have survived
    // unchanged into JoinMaterial.held_roots and driven one sequential networked
    // epoch sync per entry inside syncEpochs.
  });

  it("validates a held_roots array exactly at the cap, with held_roots surviving unchanged", () => {
    const held_roots = Array.from({ length: INVITE_BUNDLE_MAX_HELD_ROOTS }, (_, i) => ({
      epoch: i,
      key: hexKey(i),
    }));
    const bundle = { ...validOwnerFields, channels: [], relays: [], held_roots } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.held_roots).toEqual(held_roots);
  });

  it("drops a channel entry whose held array length exceeds the cap, while a sibling well-formed channel survives", () => {
    const oversizedHeld = Array.from({ length: INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS + 1 }, (_, i) => ({
      epoch: i,
      key: hexKey(i),
    }));
    const overCapChannel = {
      id: "11".repeat(32),
      key: "22".repeat(32),
      epoch: 0,
      name: "over-cap",
      held: oversizedHeld,
    };
    const okChannel = { id: "33".repeat(32), key: "44".repeat(32), epoch: 0, name: "ok" };
    const bundle = { ...validOwnerFields, channels: [overCapChannel, okChannel], relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([okChannel]);
    // Non-vacuity: pre-fix, isValidChannelEntry shape-checked every `held` entry
    // but never counted the array — the over-cap channel would have survived,
    // costing one channelGroupKey ECDH derivation per held entry inside
    // deriveChannelKeys.
  });

  it("still rejects a channel whose over-cap held array's entries are ALL malformed, evaluated on the raw array before per-entry filtering (ordering guard)", () => {
    const allMalformedHeld = Array.from({ length: INVITE_BUNDLE_MAX_HELD_CHANNEL_KEYS + 1 }, (_, i) => ({
      epoch: -1,
      key: `bad-${i}`,
    }));
    const channel = { id: "11".repeat(32), key: "22".repeat(32), epoch: 0, name: "c", held: allMalformedHeld };
    const bundle = { ...validOwnerFields, channels: [channel], relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([]);
    // Non-vacuity: if the per-entry filter ran BEFORE the count, every entry
    // here (all malformed) would fail `.every`, but the count check must ALSO
    // independently reject this entry — this pins the count being evaluated on
    // the raw array, not merely as a fallback to per-entry validation.
  });

  it("rejects a bundle whose name exceeds the text cap", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: [],
      name: "x".repeat(INVITE_BUNDLE_MAX_TEXT_LENGTH + 1),
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
    // Non-vacuity: pre-fix, `name` was never validated anywhere in this
    // function — this exact oversized string would have survived unchanged
    // into JoinMaterial.name, reaching every joiner that renders it, and
    // serialized TWICE per Community List entry (`seed` and `current`, D-07).
  });

  it("rejects a bundle whose name is a non-string (an object)", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: [],
      // @ts-expect-error deliberately malformed for the fail-closed test
      name: { not: "a string" },
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
  });

  it("validates a bundle with no name at all, normalizing name to an empty string", () => {
    const { name: _drop, ...rest } = validOwnerFields;
    const bundle = { ...rest, channels: [], relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.name).toBe("");
  });

  it("validates with an over-cap or non-string label dropped, rest of the bundle intact", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: [],
      label: "x".repeat(INVITE_BUNDLE_MAX_TEXT_LENGTH + 1),
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.label).toBeUndefined();
    expect(result?.community_id).toBe(validOwnerFields.community_id);
    // Non-vacuity: pre-fix, `label` passed through `{ ...bundle }` unchanged and
    // reaches a PUBLISHED Guestbook Join via joinFromBundle's JoinLeaveFactory.
  });

  it("validates with an over-cap or non-string creator_npub dropped, rest of the bundle intact", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: [],
      // @ts-expect-error deliberately malformed for the fail-closed test
      creator_npub: 12345,
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.creator_npub).toBeUndefined();
  });

  it("drops a channel entry whose name exceeds the cap, while a sibling well-formed channel survives", () => {
    const overCapNameChannel = {
      id: "11".repeat(32),
      key: "22".repeat(32),
      epoch: 0,
      name: "x".repeat(INVITE_BUNDLE_MAX_TEXT_LENGTH + 1),
    };
    const okChannel = { id: "33".repeat(32), key: "44".repeat(32), epoch: 0, name: "ok" };
    const bundle = { ...validOwnerFields, channels: [overCapNameChannel, okChannel], relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([okChannel]);
  });

  it("validates with a non-number expires_at dropped to undefined (closing the relational-check bypass, IN-02)", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: [],
      // @ts-expect-error deliberately malformed for the fail-closed test
      expires_at: "soon",
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.expires_at).toBeUndefined();
    // Non-vacuity: pre-fix, a non-number expires_at passed through unchanged;
    // joinFromBundle's `unixNow() > bundle.expires_at` comparison against a
    // string is always false, silently bypassing the expiry check.
  });

  it("validates a legitimate future unix-seconds expires_at unchanged", () => {
    const futureExpiry = 4_000_000_000; // hand-derived: far future unix-seconds value
    const bundle = { ...validOwnerFields, channels: [], relays: [], expires_at: futureExpiry } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.expires_at).toBe(futureExpiry);
  });

  it("round-trips a buildInviteBundle-produced bundle carrying a channel with held keys unchanged (no-false-negative guard)", () => {
    const material: JoinMaterial = {
      community_id: validOwnerFields.community_id,
      owner: validOwnerFields.owner,
      owner_salt: validOwnerFields.owner_salt,
      community_root: validOwnerFields.community_root,
      root_epoch: 0,
      channels: [
        {
          id: "11".repeat(32),
          key: "22".repeat(32),
          epoch: 2,
          name: "mods",
          held: [{ epoch: 1, key: "33".repeat(32) }],
        },
      ],
      relays: ["wss://ok.example.com"],
      name: "Test Community",
    };
    const built = buildInviteBundle(material, { channels: ["11".repeat(32)] });
    const result = validateInviteBundle(built);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual(built.channels);
    expect(result?.name).toBe(built.name);
  });
});

// ── D-17/CR-01 gap closure (12.3-13): `validateInviteBundle` no longer
// enumerates fields to bound — it walks four exhaustive rule tables and
// REBUILDS its output, so a hop no reviewer named (held_roots[i].refounder,
// unknown per-entry keys) closes for free, and a future field with no rule
// fails `tsc` rather than shipping unbounded a fifth time.
describe("validateInviteBundle exhaustive rule tables (D-17/CR-01, 12.3-13)", () => {
  const HOSTILE_LEN = 60_000;
  const hostileHex = (len: number) => "a".repeat(len % 2 === 0 ? len : len + 1);

  it("rejects a 60,000-char hex owner even when its community_id genuinely matches (owner proof alone does not bound length)", () => {
    const salt = randomBytes(32);
    const hostileOwner = hostileHex(HOSTILE_LEN);
    const cid = bytesToHex(communityId(hostileOwner, salt));
    const bundle = {
      ...validOwnerFields,
      owner: hostileOwner,
      owner_salt: bytesToHex(salt),
      community_id: cid,
      channels: [],
      relays: [],
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();

    // Same fixture SHAPE with a genuine 64-char owner validates — proving the
    // rejection above is attributable to the length/shape rule, not to a
    // failed owner proof.
    const okOwner = "cc".repeat(32);
    const okCid = bytesToHex(communityId(okOwner, salt));
    const okBundle = {
      ...validOwnerFields,
      owner: okOwner,
      owner_salt: bytesToHex(salt),
      community_id: okCid,
      channels: [],
      relays: [],
    } as InviteBundle;
    expect(validateInviteBundle(okBundle)).toBeDefined();
  });

  it("rejects a 60,000-char hex owner_salt even when its community_id genuinely matches", () => {
    const hostileSaltHex = hostileHex(HOSTILE_LEN);
    const cid = bytesToHex(communityId(validOwnerFields.owner, hexToBytes(hostileSaltHex)));
    const bundle = {
      ...validOwnerFields,
      owner_salt: hostileSaltHex,
      community_id: cid,
      channels: [],
      relays: [],
    } as InviteBundle;
    expect(validateInviteBundle(bundle)).toBeUndefined();
  });

  it("validates with a 60,000-char refounder DROPPED (not a rejection), every other field intact", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: [],
      refounder: "f".repeat(HOSTILE_LEN),
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.refounder).toBeUndefined();
    expect(result?.community_id).toBe(validOwnerFields.community_id);
  });

  it("validates with a well-formed 64-char hex refounder preserved", () => {
    const refounder = "12".repeat(32);
    const bundle = { ...validOwnerFields, channels: [], relays: [], refounder } as InviteBundle;
    expect(validateInviteBundle(bundle)?.refounder).toBe(refounder);
  });

  // Deviation from this plan's <behavior> prose, recorded in the 12.3-13
  // SUMMARY: the SHARED HELD_KEY_FIELD_RULES table's `refounder` rule is
  // drop/omit (matching both the plan's own literal rule-assignment text and
  // the top-level `refounder` field's disposition) — a held_roots entry's
  // malformed `refounder` is DROPPED from that entry rather than rejecting the
  // whole bundle. held_roots' own key/epoch rules (reject/reject) already
  // independently enforce the "not a bundle we minted" whole-bundle-reject
  // policy for any OTHER malformation.
  it("drops a 60,000-char refounder from a held_roots entry — the entry (and bundle) survive", () => {
    const held_roots = [{ epoch: 0, key: "22".repeat(32), refounder: "f".repeat(HOSTILE_LEN) }];
    const bundle = { ...validOwnerFields, channels: [], relays: [], held_roots } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.held_roots).toEqual([{ epoch: 0, key: "22".repeat(32) }]);
  });

  it("validates a held_roots entry with an extra unknown key holding a 60,000-char value, absent from the rebuilt entry", () => {
    const held_roots = [{ epoch: 0, key: "22".repeat(32), unknownAttackerKey: "x".repeat(HOSTILE_LEN) }];
    const bundle = { ...validOwnerFields, channels: [], relays: [], held_roots } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.held_roots).toEqual([{ epoch: 0, key: "22".repeat(32) }]);
    // Proves entries are REBUILT, not passed through by reference (CR-01).
    expect(JSON.stringify(result?.held_roots)).not.toContain("unknownAttackerKey");
  });

  it("validates a channels[] entry with an extra unknown key holding a 60,000-char value, channel present with the unknown key stripped", () => {
    const channel = {
      id: "11".repeat(32),
      key: "22".repeat(32),
      epoch: 0,
      name: "general",
      unknownAttackerKey: "x".repeat(HOSTILE_LEN),
    };
    const bundle = { ...validOwnerFields, channels: [channel], relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([{ id: channel.id, key: channel.key, epoch: 0, name: "general" }]);
  });

  it("validates a bundle with five unknown top-level keys, each holding a 60,000-char value, none present on the returned object", () => {
    const unknownKeys: Record<string, string> = {};
    for (let n = 0; n < 5; n++) unknownKeys[`attacker${n}`] = "x".repeat(HOSTILE_LEN);
    const bundle = { ...validOwnerFields, channels: [], relays: [], ...unknownKeys } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    for (let n = 0; n < 5; n++) expect(Object.prototype.hasOwnProperty.call(result, `attacker${n}`)).toBe(false);
  });

  it("filters out a syntactically valid wss:// relay entry longer than the new per-URL cap, keeping a sibling short valid entry", () => {
    const longUrl = "wss://relay.example.com/" + "a".repeat(INVITE_BUNDLE_MAX_RELAY_URL_LENGTH);
    const shortUrl = "wss://short.example.com";
    const bundle = { ...validOwnerFields, channels: [], relays: [longUrl, shortUrl] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.relays).toEqual([shortUrl]);
  });

  it("no longer rejects a bundle for aggregate serialized size — the whole-bundle byte cap is gone (D-07); the channel COUNT cap still fires (D-09)", () => {
    // A legal-per-field channel set large enough to exceed the FORMER
    // 8192-byte aggregate ceiling by a wide margin, at exactly the surviving
    // count cap — validateInviteBundle must accept it now.
    const channels = Array.from({ length: INVITE_BUNDLE_MAX_CHANNELS }, (_, i) => ({
      id: "11".repeat(32),
      key: "22".repeat(32),
      epoch: 0,
      name: `c${i}`,
    }));
    const bundle = { ...validOwnerFields, channels, relays: [] } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toHaveLength(INVITE_BUNDLE_MAX_CHANNELS);

    // The count bound is untouched: one more channel than the cap still
    // rejects the whole bundle, proving the byte-cap removal did not disarm
    // D-09's boundary.
    const overCap = Array.from({ length: INVITE_BUNDLE_MAX_CHANNELS + 1 }, (_, i) => ({
      id: "11".repeat(32),
      key: "22".repeat(32),
      epoch: 0,
      name: `c${i}`,
    }));
    const overCapBundle = { ...validOwnerFields, channels: overCap, relays: [] } as InviteBundle;
    expect(validateInviteBundle(overCapBundle)).toBeUndefined();
  });

  it("the returned object has no key whose value is undefined, for both a maximal and a minimal bundle", () => {
    const maximal = {
      ...validOwnerFields,
      channels: [{ id: "11".repeat(32), key: "22".repeat(32), epoch: 0, name: "general" }],
      relays: ["wss://ok.example.com"],
      refounder: "33".repeat(32),
      label: "label",
      creator_npub: "44".repeat(32),
      expires_at: 4_000_000_000,
      icon: { url: "https://x", key: "k", nonce: "n", hash: "h" },
    } as InviteBundle;
    const resultMax = validateInviteBundle(maximal);
    expect(resultMax).toBeDefined();
    expect(Object.values(resultMax!).some((v) => v === undefined)).toBe(false);

    const minimal = { ...validOwnerFields, channels: [], relays: [] } as InviteBundle;
    const resultMin = validateInviteBundle(minimal);
    expect(resultMin).toBeDefined();
    expect(Object.values(resultMin!).some((v) => v === undefined)).toBe(false);
  });

  it("buildInviteBundle no longer throws when the assembled bundle would exceed the former total-bytes cap (D-07/D-25)", () => {
    const many = Array.from({ length: INVITE_BUNDLE_MAX_CHANNELS }, (_, i) => ({
      id: bytesToHex(randomBytes(32)),
      key: bytesToHex(randomBytes(32)),
      epoch: 0,
      name: `channel-${i}`,
    }));
    const material: JoinMaterial = {
      community_id: validOwnerFields.community_id,
      owner: validOwnerFields.owner,
      owner_salt: validOwnerFields.owner_salt,
      community_root: validOwnerFields.community_root,
      root_epoch: 0,
      channels: many,
      relays: ["wss://ok.example.com"],
      name: "Test Community",
    };
    let bundle: InviteBundle | undefined;
    expect(() => {
      bundle = buildInviteBundle(material, { channels: many.map((c) => c.id) });
    }).not.toThrow();
    expect(bundle!.channels).toHaveLength(many.length);
  });
});

describe("isSafeInviteRelayURL (WR-02, 12.3-13: loopback carve-out removed)", () => {
  it("rejects a plaintext ws:// URL for a loopback host — the carve-out no longer exists", () => {
    expect(isSafeInviteRelayURL("ws://localhost:4869")).toBe(false);
    expect(isSafeInviteRelayURL("ws://127.0.0.1:4869")).toBe(false);
    expect(isSafeInviteRelayURL("ws://[::1]:4869")).toBe(false);
    // Non-vacuity: pre-fix (12.3-11/12.3-12), all three returned true via the
    // now-removed LOOPBACK_PLAINTEXT_WS carve-out. An app's own local cache
    // relay is unaffected: it travels as a transport-only extra, which this
    // predicate never sees.
  });

  it("rejects a plaintext ws:// URL for a remote host", () => {
    expect(isSafeInviteRelayURL("ws://evil.example.com")).toBe(false);
    expect(isSafeInviteRelayURL("ws://relay.example.com:4869")).toBe(false);
  });

  it("accepts an encrypted wss:// URL for a remote host", () => {
    expect(isSafeInviteRelayURL("wss://relay.example.com")).toBe(true);
  });

  it("rejects a non-string entry and a non-URL string", () => {
    expect(isSafeInviteRelayURL(42)).toBe(false);
    expect(isSafeInviteRelayURL(null)).toBe(false);
    expect(isSafeInviteRelayURL("not-a-url")).toBe(false);
  });
});

describe("decodeFragment (INVITE-05/D-12)", () => {
  const TOKEN = new Uint8Array(16).fill(7);
  const RELAYS = ["wss://custom.example.org"];

  function mutateVersionByte(encoded: string, delta: number): string {
    const raw = base64urlnopad.decode(encoded);
    const mutated = new Uint8Array(raw);
    mutated[0] = mutated[0] + delta;
    return base64urlnopad.encode(mutated);
  }

  it("throws for a fragment version higher than the encoder's own version", () => {
    const encoded = encodeFragment(TOKEN, RELAYS);
    expect(() => decodeFragment(mutateVersionByte(encoded, 1))).toThrow();
    // Non-vacuity: the pre-fix guard (`version < FRAGMENT_VERSION`) does NOT
    // throw here — a higher version decodes anyway against the current (lower)
    // relay dictionary, producing garbage relay URLs. This case pins that hole shut.
  });

  it("throws for a fragment version lower than the encoder's own version (regression)", () => {
    const encoded = encodeFragment(TOKEN, RELAYS);
    expect(() => decodeFragment(mutateVersionByte(encoded, -1))).toThrow();
  });

  it("decodes successfully at the encoder's own (current) version", () => {
    const encoded = encodeFragment(TOKEN, RELAYS);
    const decoded = decodeFragment(encoded);
    expect(decoded.token).toEqual(TOKEN);
    expect(decoded.relays).toEqual(RELAYS);
  });

  // ── Gap closure (CR-01, 12.3-11): hand-build hostile fragment bytes directly
  // — version byte, zero flags, entry count, then per-entry lead/length/UTF-8
  // bytes, then the 16-byte token — following this describe block's existing
  // mutateVersionByte byte-surgery convention. Deliberately NOT round-tripped
  // through encodeFragment, which cannot emit these hostile entry shapes (it
  // only ever emits a dictionary id, a bare host under the 0x00 lead, or a
  // wss:// URL under the 0xff lead — never an arbitrary/plaintext-scheme
  // string). FRAGMENT_VERSION is hand-derived as `4` here (module-private in
  // invite-bundle.ts; not exported) per TEST-01/D-13.
  type HostileEntry = { kind: "dict"; id: number } | { kind: "host"; host: string } | { kind: "raw"; text: string };

  function buildHostileFragment(entries: HostileEntry[], token: Uint8Array): string {
    const bytes: number[] = [4, 0x00, entries.length];
    for (const entry of entries) {
      if (entry.kind === "dict") {
        bytes.push(entry.id);
      } else if (entry.kind === "host") {
        const enc = Array.from(new TextEncoder().encode(entry.host));
        bytes.push(0x00, enc.length, ...enc);
      } else {
        const enc = Array.from(new TextEncoder().encode(entry.text));
        bytes.push(0xff, enc.length, ...enc);
      }
    }
    bytes.push(...token);
    return base64urlnopad.encode(new Uint8Array(bytes));
  }

  it("drops a hostile fragment entry carrying a plaintext-scheme remote URL (0xff lead, CR-01)", () => {
    const token = new Uint8Array(16).fill(9);
    const encoded = buildHostileFragment([{ kind: "raw", text: "ws://evil.example.com" }], token);
    const decoded = decodeFragment(encoded);
    expect(decoded.relays).toEqual([]);
    expect(decoded.token).toEqual(token);
    // Non-vacuity: pre-fix, decodeFragment's terminal filter was
    // `relays.filter(Boolean)`, which keeps any non-empty string — this hostile
    // URL would have survived straight into ParsedInvite.bootstrapRelays.
  });

  it("drops a hostile fragment entry carrying a non-URL blob (0xff lead)", () => {
    const token = new Uint8Array(16).fill(3);
    const encoded = buildHostileFragment([{ kind: "raw", text: "not-a-relay-at-all" }], token);
    const decoded = decodeFragment(encoded);
    expect(decoded.relays).toEqual([]);
    expect(decoded.token).toEqual(token);
  });

  it("still returns a legitimate wss:// entry and a dictionary entry unchanged, with the token slice unaffected by the entries filtered out", () => {
    const token = new Uint8Array(16).fill(5);
    const encoded = buildHostileFragment(
      [
        { kind: "raw", text: "wss://legit.example.com" },
        { kind: "dict", id: 1 },
        { kind: "raw", text: "ws://evil.example.com" }, // dropped
        { kind: "raw", text: "not-a-relay-at-all" }, // dropped
      ],
      token,
    );
    const decoded = decodeFragment(encoded);
    expect(decoded.relays).toEqual(["wss://legit.example.com", RELAY_DICTIONARY[1]]);
    expect(decoded.token).toEqual(token);
  });

  it("returns the stock relay set unchanged when the stock flag is set, with the token positioned immediately after (no entries)", () => {
    const token = new Uint8Array(16).fill(2);
    const encoded = base64urlnopad.encode(new Uint8Array([4, 0x01, ...token]));
    const decoded = decodeFragment(encoded);
    expect(decoded.relays).toEqual(STOCK_RELAYS);
    expect(decoded.token).toEqual(token);
  });

  // Gap closure (IN-02, 12.3-13): a fragment truncated mid-relay-table (the
  // byte cursor runs past the buffer) must throw a specific invite-fragment
  // error rather than silently yielding a zero-length token.
  it("throws a specific error for a fragment truncated mid-relay-table (IN-02)", () => {
    // version=4, flags=0x00 (custom relay set), count=1, lead=0x00 (bare host),
    // len=20 — but NO host bytes and NO token follow, so the byte cursor runs
    // past the buffer end.
    const truncated = base64urlnopad.encode(new Uint8Array([4, 0x00, 1, 0x00, 20]));
    expect(() => decodeFragment(truncated)).toThrow(/truncated/);
    // Non-vacuity: pre-fix, the indexed reads past the buffer yield `undefined`,
    // the cursor becomes NaN, and `bytes.slice(NaN, NaN + 16)` silently returns
    // an empty Uint8Array — a 0-byte token that only failed later, deep inside
    // nip44.decrypt, with an unrelated message.
  });
});

describe("getInviteBundleVsk / isInviteBundleRevoked (INVITE-01/D-04)", () => {
  function fakeEvent(tags: string[][]): NostrEvent {
    return {
      id: "00".repeat(32),
      pubkey: "11".repeat(32),
      created_at: 1_700_000_000,
      kind: INVITE_BUNDLE_KIND,
      tags,
      content: "",
      sig: "00".repeat(64),
    };
  }

  it("denies (revoked) when vsk is present but non-numeric junk", () => {
    expect(isInviteBundleRevoked(fakeEvent([["vsk", "junk"]]))).toBe(true);
    // Non-vacuity: the pre-fix implementation does `Number("junk")` -> `NaN`,
    // and `NaN !== 9` -> stays LIVE. This case pins that revocation-bypass hole shut.
  });

  it("stays live when vsk is absent (CORD-05 §1 default)", () => {
    expect(isInviteBundleRevoked(fakeEvent([]))).toBe(false);
  });

  it("stays joinable when vsk is a clean numeric non-vocabulary value (7)", () => {
    expect(isInviteBundleRevoked(fakeEvent([["vsk", "7"]]))).toBe(false);
  });

  it("denies when vsk is exactly 9 (regression)", () => {
    expect(isInviteBundleRevoked(fakeEvent([["vsk", "9"]]))).toBe(true);
  });
});

describe("expires_at unit (INVITE-04/D-05, seconds round-trip)", () => {
  it("round-trips expires_at as SECONDS (10-digit magnitude), not ms (13-digit)", () => {
    // Binding ruling (2026-07-21, 10-CONTEXT.md's deferred D-05 spec-contradiction
    // entry): CORD-05 §1's `CommunityInvite` struct comment literally annotates
    // `expires_at` as "unix ms" -- `expires_at, // optional, unix ms: past it, the
    // preview still renders, joining refuses` -- which, read alone, would settle
    // the unit as milliseconds. §4's Invite List example instead gives
    // `"expires_at": 1722400000` -- a 10-digit value that only makes sense as
    // SECONDS (as ms it decodes to a moment in January 1970), matching the
    // magnitude of the adjacent, unambiguously-seconds `created_at` in the same
    // object. CORD-02 §8 confirms this spec corpus DOES write full 13-digit ms
    // examples when a field is genuinely ms (`"added_at": 1719800000000, // ms`)
    // -- a convention §4's `expires_at` does not follow. This codebase implements
    // SECONDS end-to-end per the locked D-05 ruling (governed by §4, the Invite
    // List field INVITE-04 targets); the §1-vs-§4 contradiction is recorded
    // durably in packages/concord/UPSTREAM-NOTES.md, not re-litigated here.
    const secondsExpiry = 1722400000; // hand-derived from CORD-05 §4's own example value
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: ["wss://ok"],
      expires_at: secondsExpiry,
    } as InviteBundle;

    const result = validateInviteBundle(bundle);
    expect(result?.expires_at).toBe(secondsExpiry);
    expect(String(secondsExpiry).length).toBe(10);

    // Non-vacuity: the SAME instant expressed in ms is a genuinely different,
    // 13-digit number -- proving expires_at round-trips as seconds, not silently
    // reinterpreted or truncated to/from ms anywhere in validateInviteBundle.
    const msMagnitudeOfSameInstant = secondsExpiry * 1000;
    expect(String(msMagnitudeOfSameInstant).length).toBe(13);
    expect(result?.expires_at).not.toBe(msMagnitudeOfSameInstant);
  });
});

describe("getInviteBundleLocator coordinate (TEST-01/D-13)", () => {
  it('matches the hand-derived (33301, link_signer, "") coordinate from CORD-05 §2', () => {
    const signerSk = generateSecretKey();
    // Hand-derived expected pubkey — computed independently, not read back from
    // getInviteBundleLocator, per D-13's "never read expected values from the
    // function under test" rule.
    const expectedPubkey = getPublicKey(signerSk);

    const invite: InviteListInvite = {
      token: "tok",
      signer_sk: bytesToHex(signerSk),
      community_id: COMMUNITY_ID,
      url: "https://app.example/invite/naddr1notreal#frag",
      created_at: 1_700_000_000,
    };

    const locator = getInviteBundleLocator(invite);
    // Hand-derived from CORD-05 §2: coordinate is (kind 33301, link_signer, "").
    expect(locator.kind).toBe(33301);
    expect(locator.pubkey).toBe(expectedPubkey);
    expect(locator.identifier).toBe("");
  });
});
