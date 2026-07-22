import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, firstValueFrom } from "rxjs";
import { RelayPool } from "applesauce-relay";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import { createCommunity } from "../../helpers/community.js";
import { buildInviteBundle } from "../../helpers/invite-bundle.js";
import { DirectInviteFactory } from "../../factories/direct-invite.js";
import type { InviteBundle } from "../../types.js";
import { InviteWatcher } from "../invite-watcher.js";

async function makeInvite(bundle?: InviteBundle, recipient = new PrivateKeySigner(generateSecretKey())) {
  const inviterSk = generateSecretKey();
  const inviter = new PrivateKeySigner(inviterSk);
  const inviterPub = getPublicKey(inviterSk);
  const recipientPub = await recipient.getPublicKey();
  const material =
    bundle ??
    buildInviteBundle((await createCommunity({ ownerPubkey: inviterPub, name: "T", relays: ["wss://r"] })).material, {
      creator_npub: inviterPub,
    });
  const wrap = await DirectInviteFactory.create(material, recipientPub, inviter);
  return { wrap, bundle: material, recipient, recipientPub, inviterPub };
}

function watcher(signer: PrivateKeySigner, opts?: Partial<ConstructorParameters<typeof InviteWatcher>[0]>) {
  return new InviteWatcher({ signer, pool: new RelayPool(), relays: ["wss://relay.example"], ...opts });
}

describe("InviteWatcher", () => {
  it("tracks indexed wraps as pending until decrypted", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);

    await w.ingest(wrap);

    expect(w.wraps$.value).toEqual([wrap]);
    expect(w.pending$.value).toEqual([wrap]);
    expect(w.invites$.value).toEqual([]);
  });

  it("decrypts a pending wrap into a ConcordDirectInvite cast", async () => {
    const { wrap, recipient, inviterPub, bundle } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);

    const invite = await w.decrypt(wrap);

    expect(invite?.inviter).toBe(inviterPub);
    expect(invite?.communityId).toBe(bundle.community_id);
    expect(w.pending$.value).toEqual([]);
    expect(w.invites$.value).toEqual([invite]);
    expect(w.allInvites$.value).toEqual([invite]);
  });

  it("auto-decrypts when configured", async () => {
    const { wrap, recipient, bundle } = await makeInvite();
    const w = watcher(recipient, { autoDecrypt: true });

    await w.ingest(wrap);

    expect(w.pending$.value).toEqual([]);
    expect(w.invites$.value[0]?.communityId).toBe(bundle.community_id);
  });

  it("hides dismissed locked invites from pending", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);

    await w.dismiss(wrap);

    expect(w.isDismissed(wrap)).toBe(true);
    expect(w.pending$.value).toEqual([]);
    expect(w.wraps$.value).toEqual([wrap]);
  });

  it("hides dismissed decrypted invites but keeps them in allInvites", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);
    const invite = await w.decrypt(wrap);

    await w.dismiss(wrap);

    expect(w.invites$.value).toEqual([]);
    expect(w.allInvites$.value).toEqual([invite]);
  });

  it("restores a dismissed invite", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);
    const invite = await w.decrypt(wrap);
    await w.dismiss(wrap);

    await w.restore(wrap);

    expect(w.isDismissed(wrap)).toBe(false);
    expect(w.invites$.value).toEqual([invite]);
  });

  it("dismissal is per wrap, not per community", async () => {
    const first = await makeInvite();
    const second = await makeInvite(first.bundle, first.recipient);
    const w = watcher(first.recipient, { autoDecrypt: true });
    await w.ingest(first.wrap);

    await w.dismiss(first.wrap);
    await w.ingest(second.wrap);

    expect(w.invites$.value).toHaveLength(1);
    expect(w.invites$.value[0]?.communityId).toBe(first.bundle.community_id);
    expect(w.wraps$.value).toHaveLength(2);
  });

  it("readPending unlocks every pending invite and pendingCount$ tracks the backlog", async () => {
    const first = await makeInvite();
    const second = await makeInvite(undefined, first.recipient); // a second community, same recipient
    const w = watcher(first.recipient); // no autoDecrypt → invites stay locked/pending
    await w.ingest(first.wrap);
    await w.ingest(second.wrap);

    expect(w.pending$.value).toHaveLength(2);
    expect(await firstValueFrom(w.pendingCount$)).toBe(2);
    expect(w.invites$.value).toEqual([]);

    const unlocked = await w.readPending();

    expect(unlocked).toHaveLength(2);
    expect(w.pending$.value).toEqual([]); // nothing left to unlock
    expect(await firstValueFrom(w.pendingCount$)).toBe(0);
    expect(w.invites$.value).toHaveLength(2);
  });

  it("autoAuthenticate:false — authenticateUser satisfies needsAuth$", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const authenticated = new Set<string>();
    const challenge = "challenge-abc";
    const relay = {
      url: "wss://relay.example",
      challenge,
      challenge$: new BehaviorSubject<string | null>(challenge),
      isAuthenticated: (pk: string | string[]) => (Array.isArray(pk) ? pk : [pk]).every((p) => authenticated.has(p)),
      authenticate: async (s: { getPublicKey: () => Promise<string> }) => {
        authenticated.add(await s.getPublicKey());
        return { ok: true, from: "wss://relay.example" };
      },
      getSupported: async () => null,
    };
    const pool = {
      // Keyed by the normalized URL (trailing slash) — this mirrors RelayPool.relay()'s
      // real normalizeURL() call, which invite-watcher's transport()-merged relay set
      // now always passes through (D-03/D-12: the needs-auth check and the per-relay
      // user-auth loop both operate on the merged, mergeRelaySets-normalized set).
      status$: new BehaviorSubject({
        "wss://relay.example/": {
          url: "wss://relay.example/",
          connected: true,
          authenticated: false,
          authenticatedAs: null,
          authenticatedPubkeys: [],
          authentications: {},
          ready: true,
          authRequiredForRead: true,
          authRequiredForPublish: true,
          challenge,
        },
      }),
      relay: () => relay,
      request: () => EMPTY,
      subscription: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
    } as unknown as RelayPool;

    const w = new InviteWatcher({
      signer,
      pool,
      inboxRelays: ["wss://relay.example"],
      autoAuthenticate: false,
    });

    await w.start();
    expect(await firstValueFrom(w.needsAuth$)).toBe(true);
    await w.authenticateUser();
    expect(authenticated.has(pubkey)).toBe(true);
    expect(await firstValueFrom(w.needsAuth$)).toBe(false);

    w.stop();
  });
});
