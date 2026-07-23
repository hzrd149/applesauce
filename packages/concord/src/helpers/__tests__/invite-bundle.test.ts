// Spec-derived tests for the §1 CommunityInvite bundle guards (CORD-05) —
// every expected value below is hand-derived from the spec formula/shape, never
// read back from the function under test (TEST-01/D-13).

import { describe, expect, it } from "vitest";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";
import { base64urlnopad } from "@scure/base";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import type { NostrEvent } from "applesauce-core/helpers";

import { communityId } from "../crypto.js";
import {
  INVITE_BUNDLE_KIND,
  INVITE_BUNDLE_RELAY_CAP,
  RELAY_DICTIONARY,
  STOCK_RELAYS,
  decodeFragment,
  encodeFragment,
  isInviteBundleRevoked,
  isSafeInviteRelayURL,
  validateInviteBundle,
} from "../invite-bundle.js";
import { getInviteBundleLocator } from "../invite-list.js";
import type { InviteBundle, InviteListInvite } from "../../types.js";

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

  // Gap closure (CR-01, WR-01, 12.3-11): the relays filter now delegates to the
  // shared isSafeInviteRelayURL predicate — a remote plaintext-scheme entry is
  // dropped exactly like an http:// entry, but a loopback plaintext entry (the
  // project's own local cache-relay form) survives.
  it("drops a remote ws:// entry (WR-01) but keeps a loopback ws:// entry", () => {
    const bundle = {
      ...validOwnerFields,
      channels: [],
      relays: ["ws://evil.example.com", "ws://localhost:4869", "wss://legit.example.com"],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result?.relays).toEqual(["ws://localhost:4869", "wss://legit.example.com"]);
    // Non-vacuity: pre-fix, the filter body was `typeof entry === "string" &&
    // isSafeRelayURL(entry)` — isSafeRelayURL admits BOTH websocket schemes for
    // any host, so the remote plaintext entry would have survived into
    // JoinMaterial.relays and from there into the refounding quorum's protocol
    // set. This case pins that hole shut.
  });
});

describe("isSafeInviteRelayURL (CR-01/WR-01, 12.3-11)", () => {
  it("accepts a plaintext ws:// URL only for a loopback host", () => {
    expect(isSafeInviteRelayURL("ws://localhost:4869")).toBe(true);
    expect(isSafeInviteRelayURL("ws://127.0.0.1:4869")).toBe(true);
    expect(isSafeInviteRelayURL("ws://[::1]:4869")).toBe(true);
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
