// Spec-derived tests for the §1 CommunityInvite bundle guards (CORD-05) —
// every expected value below is hand-derived from the spec formula/shape, never
// read back from the function under test (TEST-01/D-13).

import { describe, expect, it } from "vitest";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

import { communityId } from "../crypto.js";
import { validateInviteBundle } from "../invite-bundle.js";
import type { InviteBundle } from "../../types.js";

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
