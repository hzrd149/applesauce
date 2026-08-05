import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import {
  getInviteList,
  getLiveInvites,
  INVITE_LIST_KIND,
  isInviteListUnlocked,
  isInviteLive,
  isValidInviteList,
  liveInviteEntries,
  mergeInvites,
  mergeTombstones,
  parseInviteList,
  unlockInviteList,
} from "../invite-list.js";
import { InviteListFactory } from "../../factories/invite-list.js";
import type { InviteListInvite } from "../../types.js";
import { CORD_ROUND_TRIP_SENTENCE } from "../../__tests__/cord-wire-fixtures.js";

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
    expect(parsed.entries.map((e) => e.token).sort()).toEqual(["x", "y"]);
    expect(parsed.tombstones.map((t) => t.token)).toEqual(["x"]);

    // "x" was revoked terminally, so only "y" is live.
    const live = getLiveInvites(event)!;
    expect(live.map((e) => e.token)).toEqual(["y"]);
    // getInviteList returns the cached parse after unlock.
    expect(getInviteList(event)).toEqual(parsed);
  });

  // WIRE-09/D-12: the parsed document IS the wire document, so an unrecognized top-level key
  // survives parse -> mutate -> serialize. Authority: CORD-05 §4's restatement of CORD-02 §6's
  // round-trip MUST, as vendored verbatim in CORD_ROUND_TRIP_SENTENCE (cord-wire-fixtures.ts) —
  // quoted below rather than asserted against, since the property under test is preservation of
  // hand-written unrecognized keys, not a numeric spec constant (D-21/TEST-01).
  //
  // See `CORD_ROUND_TRIP_SENTENCE` (imported below) for the exact vendored text.
  describe("WIRE-09 round-trip: unrecognized top-level keys survive parse/mutate/serialize", () => {
    it("cites CORD_ROUND_TRIP_SENTENCE (CORD-05 §4 restating CORD-02 §6) as the round-trip authority", () => {
      expect(CORD_ROUND_TRIP_SENTENCE).toContain("round-trip fields it doesn't understand");
    });

    it("parseInviteList preserves unrecognized top-level keys — a scalar and a nested object — alongside entries/tombstones", () => {
      // `future_protocol_field` stands in for a real future protocol field this client version
      // does not know (CORD-02 §6: top-level fields outside `custom` are reserved for the
      // protocol). `custom` is another client's extension data. Both must survive, for different
      // reasons (D-13).
      const custom = { schema_version: 3, flags: ["a", "b"] };
      const doc = {
        entries: [entry("x")],
        tombstones: [],
        future_protocol_field: "not-junk-a-real-future-field",
        custom,
      };
      const parsed = parseInviteList(JSON.stringify(doc));
      expect(parsed.future_protocol_field).toBe("not-junk-a-real-future-field");
      expect(parsed.custom).toEqual(custom);
      expect(parsed.entries).toHaveLength(1);
    });

    it("a document carrying ONLY an unrecognized top-level key still defaults entries/tombstones to empty arrays", () => {
      const parsed = parseInviteList(JSON.stringify({ custom: { a: 1 } }));
      expect(parsed.entries).toEqual([]);
      expect(parsed.tombstones).toEqual([]);
      expect(parsed.custom).toEqual({ a: 1 });
    });

    it("modifyInviteList (via InviteListFactory) round-trips an unrecognized top-level key through a mint, asserted on the raw re-serialized plaintext", async () => {
      const signer = new PrivateKeySigner(generateSecretKey());
      const pubkey = await signer.getPublicKey();
      const custom = { schema_version: 3, flags: ["a", "b"] };
      const plaintext = JSON.stringify({
        entries: [],
        tombstones: [],
        future_protocol_field: "not-junk-a-real-future-field",
        custom,
      });
      const content = await signer.nip44!.encrypt(pubkey, plaintext);
      const seed = await signer.signEvent({ kind: INVITE_LIST_KIND, content, tags: [], created_at: 1 });

      const minted = await InviteListFactory.modify(seed).mintInvite(entry("x")).sign(signer);

      // Assert on the RAW re-serialized plaintext (never by re-reading through parseInviteList,
      // which would let a rename hide from this test) — the wire key set and both unrecognized
      // keys must survive.
      const rawPlaintext = await signer.nip44!.decrypt(pubkey, minted.content);
      const raw = JSON.parse(rawPlaintext) as Record<string, unknown>;
      expect(Object.keys(raw).sort()).toEqual(["custom", "entries", "future_protocol_field", "tombstones"]);
      expect(raw.future_protocol_field).toBe("not-junk-a-real-future-field");
      expect(raw.custom).toEqual(custom);
      expect((raw.entries as { token: string }[]).map((e) => e.token)).toEqual(["x"]);
    });
  });
});
