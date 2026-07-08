import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import {
  getInviteList,
  getLiveInvites,
  INVITE_LIST_KIND,
  inviteListWithinByteCap,
  isInviteListUnlocked,
  isInviteLive,
  isValidInviteList,
  liveInviteEntries,
  mergeInvites,
  mergeTombstones,
  unlockInviteList,
} from "../invite-list.js";
import { InviteListFactory } from "../../factories/invite-list.js";
import type { InviteListInvite } from "../../types.js";

describe("invite-list CRDT", () => {
  const mkEntry = (token: string, id = "c") => ({
    token,
    signer_sk: "sk-" + token,
    community_id: id,
    url: "https://example.com/invite/" + token,
    created_at: 1_000,
  });

  it("merge is commutative and idempotent, and entries are immutable (first wins)", () => {
    const a = mergeInvites([], [mkEntry("x")]);
    const b = mergeInvites([], [mkEntry("y")]);
    const ab = mergeInvites(a, b);
    const ba = mergeInvites(b, a);
    expect(ab).toEqual(ba);
    expect(mergeInvites(ab, ab)).toEqual(ab);
    // A second entry with the same token never overwrites the first (immutable).
    const conflicting = mergeInvites(a, [{ ...mkEntry("x"), url: "https://evil.example/x" }]);
    expect(conflicting).toHaveLength(1);
    expect(conflicting[0].url).toBe("https://example.com/invite/x");
  });

  it("liveness: a tombstone terminally revokes and never resurrects", () => {
    let invites = mergeInvites([], [mkEntry("x")]);
    const tombstones = mergeTombstones([], [{ token: "x", community_id: "c" }]);
    expect(isInviteLive(invites, [], "x")).toBe(true);
    expect(isInviteLive(invites, tombstones, "x")).toBe(false);
    // Re-minting the same token cannot bring a revoked link back.
    invites = mergeInvites(invites, [mkEntry("x")]);
    expect(isInviteLive(invites, tombstones, "x")).toBe(false);
    expect(liveInviteEntries(invites, tombstones)).toHaveLength(0);
    expect(inviteListWithinByteCap(invites, tombstones)).toBe(true);
  });

  it("revoke unions tombstones idempotently", () => {
    let tombstones = mergeTombstones([], [{ token: "x", community_id: "c" }]);
    tombstones = mergeTombstones(tombstones, [{ token: "x", community_id: "c" }]);
    tombstones = mergeTombstones(tombstones, [{ token: "y", community_id: "c" }]);
    expect(tombstones.map((t) => t.token)).toEqual(["x", "y"]);
  });
});

describe("invite-list event helpers", () => {
  const entry = (token: string, id = "c"): InviteListInvite => ({
    token,
    signer_sk: "sk-" + token,
    community_id: id,
    url: "https://example.com/invite/" + token,
    created_at: 1_000,
  });

  // Rebuild an event stripped of the in-memory plaintext cache (a wire-fresh, locked copy).
  const relock = (event: {
    id: string;
    pubkey: string;
    created_at: number;
    kind: number;
    tags: string[][];
    content: string;
    sig: string;
  }) => ({
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.created_at,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  });

  it("isValidInviteList only matches the invite list kind", () => {
    expect(isValidInviteList({ kind: INVITE_LIST_KIND } as any)).toBe(true);
    expect(isValidInviteList({ kind: 1 } as any)).toBe(false);
  });

  it("a locked event reads as locked with no parsed list", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const event = await InviteListFactory.create().mintInvite(entry("x")).sign(signer);

    const locked = relock(event);
    expect(isInviteListUnlocked(locked)).toBe(false);
    expect(getInviteList(locked)).toBeUndefined();
    expect(getLiveInvites(locked)).toBeUndefined();
  });

  it("unlockInviteList decrypts, parses, and derives live entries", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const created = await InviteListFactory.create()
      .mintInvite(entry("x"))
      .mintInvite(entry("y"))
      .revokeInvite("x", "c")
      .sign(signer);

    const event = relock(created);
    expect(isInviteListUnlocked(event)).toBe(false);
    const parsed = await unlockInviteList(event, signer);
    expect(isInviteListUnlocked(event)).toBe(true);
    expect(parsed.invites.map((e) => e.token).sort()).toEqual(["x", "y"]);
    expect(parsed.tombstones.map((t) => t.token)).toEqual(["x"]);

    // "x" was revoked terminally, so only "y" is live.
    const live = getLiveInvites(event)!;
    expect(live.map((e) => e.token)).toEqual(["y"]);
    // getInviteList returns the cached parse after unlock.
    expect(getInviteList(event)).toEqual(parsed);
  });
});
