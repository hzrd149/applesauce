import { describe, expect, it } from "vitest";
import { bytesToHex } from "@noble/hashes/utils.js";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import "applesauce-common/casts";
import { castUser } from "applesauce-core/casts";

import "../invite-list.js";
import type { InviteWithBundle } from "../invite-list.js";
import { INVITE_LIST_KIND, mergeInvites } from "../../helpers/invite-list.js";
import { InviteBundleFactory } from "../../factories/invite-bundle.js";
import { material } from "./fixtures.js";

describe("invite list cast", () => {
  it("adds a user concordInviteList$ getter that can unlock live invite links", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const store = new EventStore();
    const invites = mergeInvites(
      [],
      [
        {
          token: "token-1",
          signer_sk: "sk-1",
          community_id: "community-1",
          url: "https://example.com/invite/token-1",
          created_at: 1,
        },
      ],
    );
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: invites, tombstones: [] }));
    const event = await signer.signEvent({ kind: INVITE_LIST_KIND, content, tags: [], created_at: 1 });

    store.add(event);

    const user = castUser(pubkey, store);
    const inviteList = await user.concordInviteList$.$first();

    expect(inviteList.unlocked).toBe(false);
    await expect(inviteList.unlock(signer)).resolves.toEqual({ invites, tombstones: [] });
    expect(inviteList.unlocked).toBe(true);
    expect(inviteList.invites?.map((entry) => entry.token)).toEqual(["token-1"]);
    expect(inviteList.tombstones).toEqual([]);
    expect(inviteList.liveInvites?.map((entry) => entry.token)).toEqual(["token-1"]);
  });

  it("exposes a reactive liveInvites$ chain that emits on unlock", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const store = new EventStore();
    const invites = mergeInvites(
      [],
      [
        {
          token: "token-1",
          signer_sk: "sk-1",
          community_id: "community-1",
          url: "https://example.com/invite/token-1",
          created_at: 1,
        },
      ],
    );
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: invites, tombstones: [] }));
    const event = await signer.signEvent({ kind: INVITE_LIST_KIND, content, tags: [], created_at: 1 });
    store.add(event);

    const user = castUser(pubkey, store);
    const inviteList = await user.concordInviteList$.$first();

    const emissions: (unknown[] | undefined)[] = [];
    const sub = inviteList.liveInvites$.subscribe((value) => emissions.push(value));

    // Locked: emits undefined until the list is unlocked.
    expect(emissions).toEqual([undefined]);

    await inviteList.unlock(signer);

    // Unlock notifies the event, re-emitting the decrypted live invites.
    expect(emissions.at(-1)).toEqual(invites);
    sub.unsubscribe();
  });

  it("resolves each invite's bundle event via bundles$", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const store = new EventStore();

    // The link_signer key that authors (and is recovered from) the bundle.
    const linkSk = generateSecretKey();
    const linkSigner = new PrivateKeySigner(linkSk);
    const token = new Uint8Array(16).fill(3);

    const invites = mergeInvites(
      [],
      [
        {
          token: bytesToHex(token),
          signer_sk: bytesToHex(linkSk),
          community_id: "community-1",
          url: "https://example.com/invite/naddr#frag",
          created_at: 1,
        },
      ],
    );
    const content = await signer.nip44!.encrypt(pubkey, JSON.stringify({ entries: invites, tombstones: [] }));
    const listEvent = await signer.signEvent({ kind: INVITE_LIST_KIND, content, tags: [], created_at: 1 });
    store.add(listEvent);

    // The live bundle edition, authored by the link_signer, present in the store.
    const bundleEvent = await InviteBundleFactory.create({ ...material("community-1") }, token).sign(linkSigner);
    store.add(bundleEvent);

    const user = castUser(pubkey, store);
    const inviteList = await user.concordInviteList$.$first();

    const emissions: (InviteWithBundle[] | undefined)[] = [];
    const sub = inviteList.bundles$.subscribe((value) => emissions.push(value));

    // Locked: no invites, so no bundle pairings yet.
    expect(emissions).toEqual([undefined]);

    await inviteList.unlock(signer);

    const pairs = emissions.at(-1);
    expect(pairs).toHaveLength(1);
    expect(pairs?.[0].invite.token).toBe(bytesToHex(token));
    expect(pairs?.[0].bundle?.event.id).toBe(bundleEvent.id);
    expect(pairs?.[0].bundle?.live).toBe(true);
    sub.unsubscribe();
  });
});
