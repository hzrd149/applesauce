import { describe, expect, it } from "vitest";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import { INVITE_LIST_KIND } from "../../helpers/invite-list.js";
import type { InviteListInvite } from "../../types.js";
import { InviteListFactory } from "../invite-list.js";
import { mintInvite, revokeInvite } from "../../operations/invite-list.js";

const entry = (token: string): InviteListInvite => ({
  token,
  signer_sk: "sk-" + token,
  community_id: "cid",
  url: "https://x/invite/" + token,
  created_at: 1,
});

async function decrypt(signer: PrivateKeySigner, content: string) {
  const pubkey = await signer.getPublicKey();
  return JSON.parse(await signer.nip44!.decrypt(pubkey, content));
}

describe("InviteListFactory", () => {
  it("create seeds an empty self-encrypted document", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const event = await InviteListFactory.create().sign(signer);
    expect(event.kind).toBe(INVITE_LIST_KIND);
    expect(event.tags).toEqual([]);
    expect(await decrypt(signer, event.content)).toEqual({ entries: [], tombstones: [] });
  });

  it("mints links, merging deltas without the caller supplying prior state", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const event = await InviteListFactory.create().mintInvite(entry("a")).mintInvite(entry("b")).sign(signer);
    const doc = await decrypt(signer, event.content);
    expect(doc.entries.map((e: InviteListInvite) => e.token)).toEqual(["a", "b"]);
    expect(doc.tombstones).toEqual([]);
  });

  it("a minted entry is immutable (re-minting the same token keeps the first)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const event = await InviteListFactory.create()
      .mintInvite(entry("a"))
      .mintInvite({ ...entry("a"), url: "https://evil/x" })
      .sign(signer);
    const doc = await decrypt(signer, event.content);
    expect(doc.entries).toHaveLength(1);
    expect(doc.entries[0].url).toBe("https://x/invite/a");
  });

  it("revokes a link by unioning in a terminal tombstone", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const event = await InviteListFactory.create().mintInvite(entry("a")).revokeInvite("a", "cid").sign(signer);
    const doc = await decrypt(signer, event.content);
    expect(doc.entries.map((e: InviteListInvite) => e.token)).toEqual(["a"]);
    expect(doc.tombstones).toEqual([{ token: "a", community_id: "cid" }]);
  });

  it("modify decrypts the existing event itself — no need to pass invites/tombstones back in", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const first = await InviteListFactory.create().mintInvite(entry("a")).sign(signer);
    const updated = await InviteListFactory.modify(first).mintInvite(entry("b")).sign(signer);
    const doc = await decrypt(signer, updated.content);
    expect(doc.entries.map((e: InviteListInvite) => e.token)).toEqual(["a", "b"]);
    expect(doc.tombstones).toEqual([]);
  });

  it("pipe chains multiple operations in a single decrypt-merge-re-encrypt", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const event = await InviteListFactory.create()
      .pipe(mintInvite(entry("a")), mintInvite(entry("b")), revokeInvite("a", "cid"))
      .sign(signer);
    const doc = await decrypt(signer, event.content);
    expect(doc.entries.map((e: InviteListInvite) => e.token)).toEqual(["a", "b"]);
    expect(doc.tombstones).toEqual([{ token: "a", community_id: "cid" }]);
  });

  it("requires a signer to encrypt", async () => {
    await expect(InviteListFactory.create().mintInvite(entry("a"))).rejects.toThrow(/signer/i);
  });
});
