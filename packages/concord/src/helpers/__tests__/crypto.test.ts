import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import { communityId, editionHash, epochKeyCommitment, groupKey } from "../crypto.js";

const SECRET = new Uint8Array(32).fill(7);
const CID = new Uint8Array(32).fill(9);

describe("crypto derivations", () => {
  it("groupKey is deterministic and epoch-sensitive", () => {
    const a = groupKey("concord/control", SECRET, CID, 0);
    const b = groupKey("concord/control", SECRET, CID, 0);
    const c = groupKey("concord/control", SECRET, CID, 1);
    expect(a.pk).toBe(b.pk);
    expect(a.convKey).toEqual(b.convKey);
    expect(a.pk).not.toBe(c.pk);
    expect(a.pk).toMatch(/^[0-9a-f]{64}$/);
  });

  it("editionHash chains on prev + content", () => {
    const eid = new Uint8Array(32).fill(1);
    const v1 = editionHash(eid, 1, undefined, new TextEncoder().encode("{}"));
    const v2 = editionHash(eid, 2, hexToBytes(v1), new TextEncoder().encode("{}"));
    expect(v1).not.toBe(v2);
    expect(editionHash(eid, 1, undefined, new TextEncoder().encode("{}"))).toBe(v1);
  });

  it("epochKeyCommitment is deterministic", () => {
    expect(bytesToHex(epochKeyCommitment(3, SECRET))).toBe(bytesToHex(epochKeyCommitment(3, SECRET)));
    expect(bytesToHex(epochKeyCommitment(3, SECRET))).not.toBe(bytesToHex(epochKeyCommitment(4, SECRET)));
  });

  it("communityId commits to owner + salt", () => {
    const salt = new Uint8Array(32).fill(2);
    const owner = "ab".repeat(32);
    expect(bytesToHex(communityId(owner, salt))).toBe(bytesToHex(communityId(owner, salt)));
  });
});
