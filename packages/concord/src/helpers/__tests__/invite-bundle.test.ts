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
  decodeFragment,
  encodeFragment,
  isInviteBundleRevoked,
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
      relays: ["wss://ok"],
    } as InviteBundle;
    const result = validateInviteBundle(bundle);
    expect(result).toBeDefined();
    expect(result?.channels).toEqual([]);
    expect(result?.relays).toEqual(["wss://ok"]);
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
