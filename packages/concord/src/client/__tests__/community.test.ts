// ConcordCommunity over a dependency-injected EventStore/RelayPool — no network.
// A fake pool (inert request/subscription/sync streams) exercises the epoch-atomic
// sync (which completes against empty relays and opens a live subscription at the
// tip) plus the fold-via-models + optimistic local-echo path. Live relay behaviour
// is covered by the puppeteer drivers.

import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, firstValueFrom } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { normalizeURL } from "applesauce-core/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import type { PublishResponse, RelayPool, RelayStatus } from "applesauce-relay";

import { getEventHash, kinds, type NostrEvent, type Rumor } from "applesauce-core/helpers/event";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import type { ConcordCommunityStatus } from "../../types.js";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { JoinLeaveFactory, SnapshotFactory } from "../../factories/guestbook.js";
import { EditionFactory } from "../../factories/control.js";
import { channelGroupKey, channelRekeyGroupKey, controlGroupKey, grantLocator } from "../../helpers/crypto.js";
import { unlockDirectInvite } from "../../helpers/direct-invite.js";
import { hasPerm } from "../../helpers/permissions.js";
import { INVITE_BUNDLE_KIND, getInviteBundle } from "../../helpers/invite-bundle.js";
import { PERM, VSK, type RumorTemplate } from "../../types.js";
import { ConcordCommunity, MissingChannelKeyError } from "../community.js";
import type { ConcordUploader } from "../storage.js";

// The control fold + sync are debounced/async; let them run before asserting.
const settle = () => new Promise((r) => setTimeout(r, 200));

// Every relay in the request acks ok:true — the default "everyone is listening"
// shape, satisfying refound()'s per-wrap majority gate (D-11) for any relay count.
const okAll = async (relays: string[]): Promise<PublishResponse[]> => relays.map((from) => ({ ok: true, from }));

// A RelayPool stand-in whose per-relay methods are inert (no sockets). The sync
// loader probes `getSupported` (→ no NIP-77) and pages `request` (→ no events).
function fakePool(): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: okAll,
  } as unknown as RelayPool;
}

// Like fakePool, but with a controllable `status$` so tests can drive connection state.
function fakePoolWithStatus(): { pool: RelayPool; status$: BehaviorSubject<Record<string, RelayStatus>> } {
  const status$ = new BehaviorSubject<Record<string, RelayStatus>>({});
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  const pool = {
    status$,
    relay: () => relay,
    subscription: () => NEVER,
    request: () => EMPTY,
    publish: okAll,
  } as unknown as RelayPool;
  return { pool, status$ };
}

function mkStatus(over: Partial<RelayStatus> & { url: string }): RelayStatus {
  return {
    connected: false,
    authenticated: false,
    authenticatedAs: null,
    authenticatedPubkeys: [],
    authentications: {},
    ready: true,
    authRequiredForRead: false,
    authRequiredForPublish: false,
    challenge: null,
    ...over,
  };
}

describe("ConcordCommunity (DI, no network)", () => {
  it("reflects genesis + chat via optimistic local echo", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Test",
      description: "hi",
      relays: ["wss://fake"],
    });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });

    // Sync walks every epoch against the empty relays, then opens live at the tip.
    await community.start();

    // Seed genesis control editions (plaintext) + owner Join via optimistic echo.
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    expect(community.state$.value.metadata?.name).toBe("Test");
    const general = community.state$.value.channels.find((c) => c.name === "general");
    expect(general).toBeDefined();
    expect(community.state$.value.members.has(pubkey)).toBe(true); // owner is a member

    // Consumers read the channel store directly with the standard timeline API.
    let messages: Rumor[] = [];
    const sub = community
      .channelStore(general!.channel_id)
      .timeline([{ kinds: [kinds.ChatMessage] }])
      .subscribe((m) => (messages = m));
    await community.sendMessage(general!.channel_id, "hello world");
    await settle();
    expect(messages.some((m) => m.content === "hello world" && m.pubkey === pubkey)).toBe(true);

    sub.unsubscribe();
    community.dispose();
  });

  it("spawns a sub-engine for a private channel and rotates its key", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const published: NostrEvent[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
    };
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Create a private channel — mints its key + publishes the CHANNEL edition;
    // once it folds, the community spawns a ConcordPrivateChannel sub-engine.
    const channelId = await community.createChannel("secret", { private: true });
    await settle();
    expect(community.state$.value.channels.find((c) => c.channel_id === channelId)?.private).toBe(true);

    // A message to the private channel lands in its (sub-engine-owned) store.
    let messages: Rumor[] = [];
    const sub = community
      .channelStore(channelId)
      .timeline([{ kinds: [kinds.ChatMessage] }])
      .subscribe((m) => (messages = m));
    await community.sendMessage(channelId, "secret hello");
    await settle();
    expect(messages.some((m) => m.content === "secret hello")).toBe(true);

    // Rotate the channel key (its own epoch 1 → 2, independent of the community root).
    await community.rotateChannel(channelId, { keep: [pubkey] });
    await settle();
    await settle();
    const rotated = community.material.channels.find((c) => c.id === channelId);
    expect(rotated?.epoch).toBe(2);
    expect(rotated?.held?.[0]?.epoch).toBe(1);

    // CHAN-05 / ROTATE-03 client-level: a subsequent send addresses the NEW
    // epoch's plane immediately, in-session, without a reload. EXPECTED is
    // computed only from channelGroupKey (CORD-03 §1's private branch) — never
    // via channelKeyFor/deriveConcordKeys — so this is non-self-referential.
    const expectedEpoch2 = channelGroupKey(hexToBytes(rotated!.key), hexToBytes(channelId), 2);
    const expectedEpoch1 = channelGroupKey(hexToBytes(rotated!.held![0].key), hexToBytes(channelId), 1);
    expect(expectedEpoch2.pk).not.toBe(expectedEpoch1.pk);

    published.length = 0;
    await community.sendMessage(channelId, "post-rotation hello");
    await settle();
    const wrap = published.find((e) => e.kind === kinds.GiftWrap);
    expect(wrap).toBeDefined();
    expect(wrap!.pubkey).toBe(expectedEpoch2.pk);
    expect(wrap!.pubkey).not.toBe(expectedEpoch1.pk);

    sub.unsubscribe();
    community.dispose();
  });

  it("channels$ flips accessible:true when a key is granted out-of-band with no control-plane fold (CHAN-06)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Mint a private channel — the owner auto-holds its key (mintChannelKey).
    const channelId = await community.createChannel("secret", { private: true });
    await settle();

    // Capture the minted key, then drop it locally (leaveChannel ONLY mutates
    // material.channels + disposes the sub-engine — no control-plane fold, no
    // state$ re-emission), leaving the channel's metadata still folded (visible)
    // but keyless: the exact "visible but inaccessible" state CHAN-06 targets.
    const key = community.material.channels.find((c) => c.id === channelId)!;
    await community.leaveChannel(channelId);
    expect(community.material.channels.some((c) => c.id === channelId)).toBe(false);
    expect(community.state$.value.channels.some((c) => c.channel_id === channelId)).toBe(true);

    const views: boolean[] = [];
    const sub = community.channels$.subscribe((v) => {
      const entry = v.find((c) => c.channel_id === channelId);
      views.push(entry?.accessible ?? false);
    });

    // Sanity: the pre-grant emission (subscribe replays the current combineLatest
    // value synchronously) shows accessible:false — no key held.
    expect(views.at(-1)).toBe(false);

    // Grant the key back — this is the Direct Invite delivery path
    // (receiveChannelKeys). NOTHING else touches community/state$ between this
    // call and the assertion below: no sendMessage, no fold, no settle-triggering
    // action. If channels$ only reacted to state$ (the pre-fix behavior), this
    // emission would never arrive and the assertion below would see the stale
    // accessible:false value — proving the grant alone is the sole trigger.
    expect(community.receiveChannelKeys([key])).toBe(true);

    // channels$ reacted to the grant alone, driven by materialChanged$.
    expect(views.at(-1)).toBe(true);
    expect(views.length).toBeGreaterThan(1);

    sub.unsubscribe();
    community.dispose();
  });

  it("sendMessage to a keyless private channel throws MissingChannelKeyError, not unknown channel (CHAN-02 / TEST-02 case 4)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Mint a private channel, then drop the key locally so the channel is folded
    // (visible in state$.value.channels) but keyless — the exact "known but
    // keyless private" state the guard exists to distinguish from a truly-unknown id.
    const channelId = await community.createChannel("secret", { private: true });
    await settle();
    await community.leaveChannel(channelId);
    expect(community.material.channels.some((c) => c.id === channelId)).toBe(false);
    expect(community.state$.value.channels.some((c) => c.channel_id === channelId)).toBe(true);

    let error: unknown;
    try {
      await community.sendMessage(channelId, "should not send");
    } catch (err) {
      error = err;
    }
    // Distinct from planeKeyFor's generic "unknown channel" backstop — the exact
    // distinction the Accordian composer bug needed.
    expect(error).toBeInstanceOf(MissingChannelKeyError);
    expect((error as MissingChannelKeyError).message).toBe("missing private channel key");
    expect((error as MissingChannelKeyError).channelId).toBe(channelId);

    community.dispose();
  });

  it("every channel-plane write path (react/editMessage/deleteMessage/sendThread/replyToThread) throws MissingChannelKeyError for a keyless private channel, not unknown channel (CHAN-02 / WR-01)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Mint a private channel, then drop the key locally so the channel is folded
    // (visible in state$.value.channels) but keyless — the exact "known but
    // keyless private" state the guard exists to distinguish from a truly-unknown id.
    const channelId = await community.createChannel("secret", { private: true });
    await settle();
    await community.leaveChannel(channelId);
    expect(community.material.channels.some((c) => c.id === channelId)).toBe(false);
    expect(community.state$.value.channels.some((c) => c.channel_id === channelId)).toBe(true);

    const target = { id: "0".repeat(64), author: pubkey };
    const invocations: Array<[string, () => Promise<void>]> = [
      ["react", () => community.react(channelId, target, "+")],
      ["editMessage", () => community.editMessage(channelId, target.id, "x")],
      ["deleteMessage", () => community.deleteMessage(channelId, target.id)],
      ["sendThread", () => community.sendThread(channelId, "t", "b")],
      ["replyToThread", () => community.replyToThread(channelId, target, "b")],
    ];

    for (const [name, invoke] of invocations) {
      let error: unknown;
      try {
        await invoke();
      } catch (err) {
        error = err;
      }
      expect(error, `${name} should throw`).toBeInstanceOf(MissingChannelKeyError);
      expect((error as MissingChannelKeyError).message, `${name} message`).toBe("missing private channel key");
      expect((error as MissingChannelKeyError).message, `${name} must not be the generic backstop`).not.toBe(
        "unknown channel",
      );
      expect((error as MissingChannelKeyError).channelId, `${name} channelId`).toBe(channelId);
    }

    community.dispose();
  });

  it("direct-invite grant flow: send succeeds after receiveChannelKeys folds the key (TEST-02 case 5)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Same channel as case 4: mint, capture the key, drop it locally.
    const channelId = await community.createChannel("secret", { private: true });
    await settle();
    const key = community.material.channels.find((c) => c.id === channelId)!;
    await community.leaveChannel(channelId);
    expect(community.material.channels.some((c) => c.id === channelId)).toBe(false);

    // Grant it back — the direct-invite / channel-grant delivery path.
    expect(community.receiveChannelKeys([key])).toBe(true);

    let messages: Rumor[] = [];
    const sub = community
      .channelStore(channelId)
      .timeline([{ kinds: [kinds.ChatMessage] }])
      .subscribe((m) => (messages = m));
    await expect(community.sendMessage(channelId, "granted hello")).resolves.toBeUndefined();
    await settle();
    expect(messages.some((m) => m.content === "granted hello")).toBe(true);

    sub.unsubscribe();
    community.dispose();
  });

  it("grants a private channel via a Direct Invite carrying only that channel key, and merges/leaves it", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const member = new PrivateKeySigner(generateSecretKey());
    const memberPub = await member.getPublicKey();
    const pool = fakePool();
    const published: NostrEvent[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
    };
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Two private channels — the grant must carry ONLY the named one, never the other.
    const secret = await community.createChannel("secret", { private: true });
    const other = await community.createChannel("other", { private: true });
    await settle();

    // A channel-scoped membership role folds with its channel_id intact (CORD-04 §2).
    const roleId = await community.createRole("#secret", 1, 0n, { kind: "channel", channel_id: secret });
    await settle();
    const role = community.state$.value.roles.find((r) => r.role_id === roleId);
    expect(role?.scope).toEqual({ kind: "channel", channel_id: secret });

    // Deliver-on-grant: a Direct Invite (kind 1059, indexed k:3313, p=member).
    published.length = 0;
    await community.grantChannelAccess(secret, memberPub);
    const wrap = published.find(
      (e) =>
        e.kind === kinds.GiftWrap &&
        e.tags.some((t) => t[0] === "p" && t[1] === memberPub) &&
        e.tags.some((t) => t[0] === "k" && t[1] === "3313"),
    );
    expect(wrap).toBeDefined();

    // The bundle self-certifies and carries exactly the one granted channel key.
    const bundle = await unlockDirectInvite(wrap!, member);
    expect(bundle?.community_id).toBe(community.material.community_id);
    expect(bundle?.channels.map((c) => c.id)).toEqual([secret]);
    expect(bundle?.channels.some((c) => c.id === other)).toBe(false);

    // The member (who holds none of the community's channel keys yet) merges it.
    const memberEngine = new ConcordCommunity({
      material: { ...bundle!, channels: [] },
      signer: member,
      pubkey: memberPub,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await memberEngine.start();
    expect(memberEngine.receiveChannelKeys(bundle!.channels)).toBe(true);
    expect(memberEngine.material.channels.map((c) => c.id)).toContain(secret);
    // Idempotent: a redelivered grant merges nothing new.
    expect(memberEngine.receiveChannelKeys(bundle!.channels)).toBe(false);

    // Leaving drops the key locally with no rotation.
    await memberEngine.leaveChannel(secret);
    expect(memberEngine.material.channels.some((c) => c.id === secret)).toBe(false);

    // grantChannelAccess needs MANAGE_CHANNELS — an unprivileged member cannot grant.
    expect(community.canDo(PERM.MANAGE_CHANNELS)).toBe(true); // owner can
    community.dispose();
    memberEngine.dispose();
  });

  it("grants a hand-picked subset of private channels in one Direct Invite (CORD-05 §6)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const member = new PrivateKeySigner(generateSecretKey());
    const memberPub = await member.getPublicKey();
    const pool = fakePool();
    const published: NostrEvent[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
    };
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Three private channels; grant exactly two of them.
    const a = await community.createChannel("a", { private: true });
    const b = await community.createChannel("b", { private: true });
    const c = await community.createChannel("c", { private: true });
    await settle();

    published.length = 0;
    await community.grantChannelAccess([a, b], memberPub);
    const wrap = published.find(
      (e) =>
        e.kind === kinds.GiftWrap &&
        e.tags.some((t) => t[0] === "p" && t[1] === memberPub) &&
        e.tags.some((t) => t[0] === "k" && t[1] === "3313"),
    );
    expect(wrap).toBeDefined();

    // The bundle carries exactly the two granted channels — never the third.
    const bundle = await unlockDirectInvite(wrap!, member);
    expect(bundle?.channels.map((ch) => ch.id).sort()).toEqual([a, b].sort());
    expect(bundle?.channels.some((ch) => ch.id === c)).toBe(false);

    // The member folds both keys from the one invite.
    const memberEngine = new ConcordCommunity({
      material: { ...bundle!, channels: [] },
      signer: member,
      pubkey: memberPub,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await memberEngine.start();
    expect(memberEngine.receiveChannelKeys(bundle!.channels)).toBe(true);
    const held = memberEngine.material.channels.map((ch) => ch.id);
    expect(held).toContain(a);
    expect(held).toContain(b);
    expect(held).not.toContain(c);

    // Granting a channel we don't hold throws before anything is published.
    await expect(community.grantChannelAccess([a, "ff".repeat(32)], memberPub)).rejects.toThrow();

    community.dispose();
    memberEngine.dispose();
  });

  it("refreshes live invite bundles behind their URL after a Refounding (CORD-05 §2)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const published: NostrEvent[] = [];
    (pool as unknown as { publish: unknown }).publish = async (relays: string[], event: NostrEvent) => {
      published.push(event);
      return okAll(relays);
    };
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    let refoundedCid: string | undefined;
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
      onRefounded: (cid) => {
        refoundedCid = cid;
      },
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const secret = await community.createChannel("secret", { private: true });
    const other = await community.createChannel("other", { private: true });
    await settle();

    const link = await community.createInvite({ base: "https://x.io", label: "Reddit", channels: [secret] });
    const priorRoot = community.material.community_root;
    // The freshly minted bundle carries the current (pre-Refounding) root.
    const minted = published.find((e) => e.kind === INVITE_BUNDLE_KIND && e.pubkey === link.signerPubkey)!;
    const mintedBundle = getInviteBundle(minted, hexToBytes(link.token));
    expect(mintedBundle?.community_root).toBe(priorRoot);
    expect(mintedBundle?.channels.map((c) => c.id)).toEqual([secret]);
    expect(mintedBundle?.channels.map((c) => c.id)).not.toContain(other);

    // Refound: the root rolls, and the community signals onRefounded (the client's
    // cue to drive the refresh, which needs the link secret it holds).
    await community.refound({ keep: [pubkey] });
    expect(refoundedCid).toBe(community.communityId);
    const newRoot = community.material.community_root;
    expect(newRoot).not.toBe(priorRoot);

    // The refresh re-posts the bundle at the SAME coordinate, now carrying the new root.
    published.length = 0;
    await community.refreshInviteBundles([link]);
    const refreshed = published.find((e) => e.kind === INVITE_BUNDLE_KIND && e.pubkey === link.signerPubkey);
    expect(refreshed).toBeDefined();
    expect(refreshed!.tags.find((t) => t[0] === "d")?.[1]).toBe("");
    const bundle = getInviteBundle(refreshed!, hexToBytes(link.token));
    expect(bundle?.community_root).toBe(newRoot);
    expect(bundle?.root_epoch).toBe(community.material.root_epoch);
    expect(bundle?.label).toBe("Reddit");
    expect(bundle?.channels.map((c) => c.id)).toEqual([secret]);
    expect(bundle?.channels.map((c) => c.id)).not.toContain(other);

    community.dispose();
  });

  it("deleteRole retires a role: still visible in state but confers no authority", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const member = bytesToHex(generateSecretKey());
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const roleId = await community.createRole("Mod", 5, PERM.KICK);
    await community.grantRoles(member, [roleId]);
    await settle();
    expect(community.standingOf(member).permissions & PERM.KICK).toBe(PERM.KICK);

    await community.deleteRole(roleId);
    await settle();

    const role = community.state$.value.roles.find((r) => r.role_id === roleId);
    expect(role?.deleted).toBe(true); // still present, flagged deleted
    expect(community.standingOf(member).permissions).toBe(0n); // authority stripped
    expect(community.state$.value.grants.get(member)).toEqual([roleId]); // grant untouched

    community.dispose();
  });

  it("refound compacts control heads (seals recovered) and does not leak private-channel keys", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const published: NostrEvent[] = [];
    (pool as unknown as { publish: unknown }).publish = async (relays: string[], event: NostrEvent) => {
      published.push(event);
      return okAll(relays);
    };
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();
    const channelId = await community.createChannel("secret", { private: true });
    await settle();
    await community.sendMessage(channelId, "secret hello");
    await settle();

    const cid = hexToBytes(community.material.community_id);
    const priorRoot = hexToBytes(community.material.community_root);
    const channel = community.material.channels.find((c) => c.id === channelId)!;
    const channelRekeyAddr = channelRekeyGroupKey(priorRoot, hexToBytes(channelId), channel.epoch + 1).pk;

    // Refound WITHOUT naming the private channel: no rekey blob should be published
    // to its address — a kept member who was never in it must not receive its key.
    published.length = 0;
    await community.refound({ keep: [pubkey] });
    await settle();
    expect(published.some((e) => e.pubkey === channelRekeyAddr)).toBe(false);

    // Compaction re-wrapped the folded control heads into the NEW epoch's control
    // plane — proving the plaintext seals were recovered from the wrap store (they
    // are stripped from the RumorStore fold).
    const newControlPk = controlGroupKey(
      hexToBytes(community.material.community_root),
      cid,
      community.material.root_epoch,
    ).pk;
    expect(published.some((e) => e.pubkey === newControlPk)).toBe(true);

    // A refound that DOES name the channel rotates it (delivered to its keep set).
    const priorRoot2 = hexToBytes(community.material.community_root);
    const channel2 = community.material.channels.find((c) => c.id === channelId)!;
    const channelRekeyAddr2 = channelRekeyGroupKey(priorRoot2, hexToBytes(channelId), channel2.epoch + 1).pk;
    published.length = 0;
    await community.refound({ keep: [pubkey], channelRekeys: [{ channelId, keep: [pubkey] }] });
    await settle();
    expect(published.some((e) => e.pubkey === channelRekeyAddr2)).toBe(true);

    community.dispose();
  });

  it("refound() aborts before compaction/adoption when the root-roll wrap misses majority, and succeeds once it clears majority (D-09/D-11, ROTATE-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const relays = ["wss://a", "wss://b", "wss://c"];
    // n = 3 relays; threshold = ⌈(n+1)/2⌉ = ⌈4/2⌉ = 2 — hand-derived (D-11), never
    // read back from `refound()`'s own threshold computation.
    const threshold = 2;
    const okResponses = (okCount: number): PublishResponse[] =>
      relays.map((from, i) => (i < okCount ? { ok: true, from } : { ok: false, from, message: "Timeout" }));

    const pool = fakePool();
    const calls: NostrEvent[] = [];
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], event: NostrEvent) => {
      calls.push(event);
      return responses;
    };

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays });
    let refoundedCount = 0;
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays,
      onRefounded: () => refoundedCount++,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const priorEpoch = community.material.root_epoch;
    const priorRoot = community.material.community_root;

    // MINORITY (threshold - 1 of 3 ok, including a Timeout not-ok): the single
    // root-roll wrap (recipients = [pubkey] only) misses the threshold —
    // refound() must reject BEFORE any compaction/snapshot publish or adoption.
    responses = okResponses(threshold - 1);
    calls.length = 0;
    await expect(community.refound({ keep: [pubkey] })).rejects.toThrow(/majority/);
    expect(calls.length).toBe(1); // only the gated root-roll wrap was attempted
    expect(community.material.root_epoch).toBe(priorEpoch);
    expect(community.material.community_root).toBe(priorRoot);
    expect(refoundedCount).toBe(0);

    // MAJORITY control (exactly `threshold` of 3 ok): the same wrap now clears
    // the threshold — refound() completes, compaction/snapshot publish, adoption.
    responses = okResponses(threshold);
    calls.length = 0;
    await community.refound({ keep: [pubkey] });
    expect(calls.length).toBeGreaterThan(1); // gated wrap + compaction/snapshot wraps
    expect(community.material.root_epoch).toBe(priorEpoch + 1);
    expect(community.material.community_root).not.toBe(priorRoot);
    expect(refoundedCount).toBe(1);

    community.dispose();
  });

  it("honors the NEW epoch's guestbook snapshot after a Refounding, not the prior epoch's", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // The epoch-0 snapshot names two members carried ONLY by it (never an author,
    // so not "observed"): memberM (kept through the coming Refounding) and
    // memberX (excluded).
    const memberM = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
    const memberX = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
    const oldSnapshot = await SnapshotFactory.create(
      [pubkey, memberM, memberX],
      bytesToHex(generateSecretKey()),
      1,
      1,
      Date.now(),
    );
    await community.publishToPlane({ plane: "guestbook" }, oldSnapshot, {});
    await settle();

    // Before a Refounding the epoch has no refounder → the snapshot is not honored.
    expect(community.material.refounder).toBeUndefined();
    expect(community.state$.value.members.has(memberM)).toBe(false);
    expect(community.state$.value.members.has(memberX)).toBe(false);

    // Refound keeping memberM, excluding memberX. The new epoch's Guestbook
    // (`guestbook@1`) starts empty — the CORD-02 §5 epoch-0 snapshot lives on
    // `guestbook@0` and is never read by the new epoch's fold, so neither member
    // is seeded yet by it.
    await community.refound({ keep: [pubkey, memberM] });
    await settle();
    expect(community.material.refounder).toBe(pubkey);
    expect(community.state$.value.members.has(memberM)).toBe(false);
    expect(community.state$.value.members.has(memberX)).toBe(false);

    // Simulate the refounder's new-epoch snapshot (`buildRefounding`'s non-gating
    // step, CORD-02 §5) landing on `guestbook@1` — present-members-only, so it
    // names memberM (kept) but never memberX (excluded).
    const newSnapshot = rumorFromTemplate(
      await SnapshotFactory.create([pubkey, memberM], bytesToHex(generateSecretKey()), 1, 1, Date.now()),
      pubkey,
    );
    community.guestbookStore.add(newSnapshot);
    await settle();

    // The NEW epoch's snapshot seeds memberM...
    expect(community.state$.value.members.has(memberM)).toBe(true);
    // ...but memberX, whose only-ever seed was the OLD epoch's snapshot, stays
    // absent: prior-epoch seeding does not carry across a Refounding (ROTATE-04).
    expect(community.state$.value.members.has(memberX)).toBe(false);

    community.dispose();
  });

  it("drops a member excluded by a Refounding even with a prior-epoch Join or observed authorship (ROTATE-04)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // A member with an epoch-0 self-signed Join.
    const memberJoin = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
    community.guestbookStore.add(rumorFromTemplate(await JoinLeaveFactory.create("join"), memberJoin, 1_000));
    await settle();
    expect(community.state$.value.members.has(memberJoin)).toBe(true);

    // A member with ONLY epoch-0 OBSERVED authorship — a guestbook-plane rumor of
    // no Join/Leave/Kick/Snapshot kind, admitted via `foldMembers`'s `!c`
    // forward-observation branch (guestbook.ts:109-111).
    const memberObserved = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
    community.guestbookStore.add(rumorFromTemplate({ kind: 1, content: "hi", tags: [] }, memberObserved, 1_500));
    await settle();
    expect(community.state$.value.members.has(memberObserved)).toBe(true);

    // Refound keeping only the owner — neither member is kept.
    await community.refound({ keep: [pubkey] });
    await settle();

    // Both members' ONLY activity lives on `guestbook@0`; the new epoch's fold
    // reads only `guestbook@1`, so neither the prior-epoch Join nor the
    // prior-epoch observed authorship resurrects them.
    expect(community.state$.value.members.has(memberJoin)).toBe(false);
    expect(community.state$.value.members.has(memberObserved)).toBe(false);

    community.dispose();
  });

  it("D-03: disposes+deletes a guestbook store whose epoch ages out of held_roots", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Refound #1: epoch 0 → 1. `held_roots` retains epoch 0, so its guestbook
    // store stays addressable — nothing is trimmed yet.
    await community.refound({ keep: [pubkey] });
    await settle();
    const stores = (community as unknown as { stores: Map<string, { dispose: () => void }> }).stores;
    const epoch0Store = stores.get("guestbook@0");
    expect(epoch0Store).toBeDefined();
    const disposeSpy = vi.spyOn(epoch0Store!, "dispose");

    // No compaction step exists yet to age epoch 0 out of `held_roots` (that's a
    // later phase's concern) — simulate its precondition directly so the D-03
    // trim's own contract ("an epoch no longer in held_roots gets its store
    // disposed") is exercised independent of whatever eventually ages it out.
    const keys = (
      community as unknown as { keys: { material: { held_roots: Array<{ epoch: number; key: string }> } } }
    ).keys;
    keys.material.held_roots = [];

    // Refound #2: epoch 1 → 2. Epoch 0 is now neither current nor held — trimmed.
    await community.refound({ keep: [pubkey] });
    await settle();

    expect(disposeSpy).toHaveBeenCalled();
    expect(stores.has("guestbook@0")).toBe(false);
    // Epoch 1's store is retained: `rollForward` always prepends the epoch it
    // rolls FROM, so epoch 1 is in the fresh `held_roots`.
    expect(stores.has("guestbook@1")).toBe(true);

    community.dispose();
  });

  it("refound() rejects excluding a target the caller does not outrank, and publishes nothing (AUTH-02)", async () => {
    const ownerSigner = new PrivateKeySigner(generateSecretKey());
    const owner = await ownerSigner.getPublicKey();
    const memberSigner = new PrivateKeySigner(generateSecretKey());
    const member = await memberSigner.getPublicKey();
    const pool = fakePool();
    const published: NostrEvent[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
    };
    const genesis = await createCommunity({ ownerPubkey: owner, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer: memberSigner,
      pubkey: member,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const t of genesis.controlRumors) community.controlStore.add(rumorFromTemplate(t, owner));
    await settle();

    // Grant the member BAN at position 5 — outranks a roleless member, but never
    // the owner (position 0, supreme/unremovable per CORD-04 §2).
    const roleId = "03".repeat(32);
    const role = {
      role_id: roleId,
      name: "Banhammer",
      position: 5,
      permissions: PERM.BAN.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    const roleEd = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });
    community.controlStore.add(rumorFromTemplate(roleEd, owner, 2_000));

    const grantEid = grantLocator(hexToBytes(genesis.material.community_id), member);
    const grantEd = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid: grantEid,
      version: 1,
      content: JSON.stringify({ member, role_ids: [roleId] }),
    });
    community.controlStore.add(rumorFromTemplate(grantEd, owner, 3_000));
    await settle();
    expect(community.canDo(PERM.BAN)).toBe(true);

    // The member (position 5) does not outrank the owner (position 0) — rejected,
    // and nothing is published (atomic abort, D-06).
    published.length = 0;
    await expect(community.refound({ keep: [], exclude: [owner] })).rejects.toThrow(/outrank/);
    expect(published).toEqual([]);

    community.dispose();
  });

  it("D-04: passing state.members as the next refound()'s keep does not re-admit a dropped member", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const memberX = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
    community.guestbookStore.add(rumorFromTemplate(await JoinLeaveFactory.create("join"), memberX, 1_000));
    await settle();
    expect(community.state$.value.members.has(memberX)).toBe(true);

    // Exclude memberX.
    await community.refound({ keep: [pubkey], exclude: [memberX] });
    await settle();
    expect(community.state$.value.members.has(memberX)).toBe(false);

    // Feed the folded member Set straight back in as the next keep list — the
    // exact footgun D-04 guards against (resolved structurally by D-01/D-02: once
    // the fold drops a removed member, `state.members` no longer contains them).
    await community.refound({ keep: [...community.state$.value.members] });
    await settle();
    expect(community.state$.value.members.has(memberX)).toBe(false);

    community.dispose();
  });

  it("Open Question 1 (DEFERRED to Phase 7): an excluded member's OLD public-channel message still counts as observed post-Refounding", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const general = community.state$.value.channels.find((c) => c.name === "general")!;
    const memberX = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
    // memberX's only activity is an OLD (pre-Refounding) message in a PUBLIC
    // channel. Public-channel stores are deliberately NOT epoch-keyed this phase
    // (`planeStoreKey`'s `"channel"` branch is untouched — channel keying is Phase
    // 7 territory), so this message stays visible to `observed` across the
    // Refounding.
    community.channelStore(general.channel_id).add(rumorFromTemplate({ kind: 9, content: "hi", tags: [] }, memberX, 1_000));
    await settle();
    expect(community.state$.value.members.has(memberX)).toBe(true);

    await community.refound({ keep: [pubkey] }); // memberX not kept
    await settle();

    // KNOWN RESIDUAL (Open Question 1, DEFERRED to Phase 7 channel-keying): the
    // public-channel store is un-epoch-scoped, so memberX's old message still
    // registers as observed and they remain a "member" post-Refounding. This
    // pins the CURRENT behavior as a regression fixture — it is not asserted as
    // correct, and Phase 7's channel epoch-keying is expected to close it.
    expect(community.state$.value.members.has(memberX)).toBe(true);

    community.dispose();
  });

  it("exposes a descriptive status$ (idle → syncing → live + connection)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, status$ } = fakePoolWithStatus();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "T", relays: ["wss://fake"] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });

    expect(community.phase$.value).toBe("idle");
    await community.start(); // walks the empty relays to the tip, then opens live
    expect(community.phase$.value).toBe("live");
    expect(community.epoch$.value).toBe(genesis.material.root_epoch);

    // Subscribe to the aggregate BEFORE driving the pool so it tracks the latest.
    let snap: ConcordCommunityStatus | undefined;
    const sub = community.status$.subscribe((v) => (snap = v));
    expect(snap?.phase).toBe("live");
    expect(snap?.connected).toBe(false);
    expect(snap?.error).toBeNull();

    // A relay socket opens (gates nothing behind auth) → connected + authenticated flip.
    const url = normalizeURL("wss://fake");
    status$.next({ [url]: mkStatus({ url, connected: true }) });
    expect(snap?.connected).toBe(true);
    expect(snap?.authenticated).toBe(true);

    sub.unsubscribe();
    community.dispose();
  });
});

// A rumor authored by `pubkey`, so owner-signed control editions can be fed into a
// member's engine directly (the fold reads the author off the rumor).
function rumorFromTemplate(template: RumorTemplate, pubkey: string, ms = 1_000): Rumor {
  const tags = template.tags.filter((t) => t[0] !== "ms");
  tags.push(["ms", String(ms % 1000)]);
  const rumor: Rumor = {
    kind: template.kind,
    pubkey,
    content: template.content,
    tags,
    created_at: Math.floor(ms / 1000),
    id: "",
  };
  rumor.id = getEventHash(rumor);
  return rumor;
}

describe("ConcordCommunity permissions + granular reads", () => {
  /** An engine whose logged-in user is a plain member, seeded with owner genesis. */
  async function memberCommunity(uploader?: ConcordUploader) {
    const ownerSigner = new PrivateKeySigner(generateSecretKey());
    const owner = await ownerSigner.getPublicKey();
    const memberSigner = new PrivateKeySigner(generateSecretKey());
    const member = await memberSigner.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({
      ownerPubkey: owner,
      name: "Test",
      description: "d",
      relays: ["wss://fake"],
    });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer: memberSigner,
      pubkey: member,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      uploader,
      relays: ["wss://fake"],
    });
    await community.start();
    for (const t of genesis.controlRumors) community.controlStore.add(rumorFromTemplate(t, owner));
    await settle();
    return { community, owner, member, genesis };
  }

  it("can$ re-emits when a grant changes the answer", async () => {
    const { community, owner, member, genesis } = await memberCommunity();

    const seen: boolean[] = [];
    const sub = community.can$(PERM.MANAGE_CHANNELS).subscribe((v) => seen.push(v));
    expect(seen).toEqual([false]);

    // The owner mints a MANAGE_CHANNELS role and grants it to the member.
    const roleId = "01".repeat(32);
    const role = {
      role_id: roleId,
      name: "Mods",
      position: 5,
      permissions: PERM.MANAGE_CHANNELS.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    const roleEd = await EditionFactory.create({
      vsk: VSK.ROLE,
      eid: roleId,
      version: 1,
      content: JSON.stringify(role),
    });
    community.controlStore.add(rumorFromTemplate(roleEd, owner, 2_000));

    const grantEid = grantLocator(hexToBytes(genesis.material.community_id), member);
    const grantEd = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid: grantEid,
      version: 1,
      content: JSON.stringify({ member, role_ids: [roleId] }),
    });
    community.controlStore.add(rumorFromTemplate(grantEd, owner, 3_000));
    await settle();

    // The point of the reactive form: a `canDo` read in a render path would have
    // been captured at `false` and never recomputed.
    expect(seen).toEqual([false, true]);
    expect(community.canDo(PERM.MANAGE_CHANNELS)).toBe(true);

    sub.unsubscribe();
    community.dispose();
  });

  it("community.admin spans planes, and the flat aliases hit the same code", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const owner = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({
      ownerPubkey: owner,
      name: "Test",
      description: "d",
      relays: ["wss://fake"],
    });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey: owner,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // A control-plane edition, implemented on admin.
    await community.admin.editMetadata({ description: "via admin" });
    await settle();
    expect(community.state$.value.metadata?.description).toBe("via admin");

    const roleId = await community.admin.createRole("Mods", 5, PERM.KICK);
    await settle();
    expect(community.state$.value.roles.some((r) => r.role_id === roleId)).toBe(true);

    // A cross-plane composite, delegated back to the community — the flat method is
    // the implementation, so a delegation cycle here would blow the stack.
    const target = "dd".repeat(32);
    await community.admin.ban(target);
    await settle();
    expect(community.state$.value.banlist.has(target)).toBe(true);

    await community.admin.kick(target);
    await settle();
    // The Kick lands on the guestbook — the plane `admin.ban` never touches.
    const kicks = await Promise.resolve(community.guestbookStore.getTimeline([{ kinds: [3309] }]));
    expect(kicks.some((r) => r.tags.some((t) => t[0] === "p" && t[1] === target))).toBe(true);

    // The flat alias and the namespaced call are the same method.
    expect(community.ban).toBeInstanceOf(Function);
    await community.unban(target);
    await settle();
    expect(community.state$.value.banlist.has(target)).toBe(false);

    community.dispose();
  });

  it("kick() rejects locally before any publish when the caller lacks KICK or does not outrank the target (AUTH-05)", async () => {
    const ownerSigner = new PrivateKeySigner(generateSecretKey());
    const owner = await ownerSigner.getPublicKey();
    const memberSigner = new PrivateKeySigner(generateSecretKey());
    const member = await memberSigner.getPublicKey();
    const pool = fakePool();
    const published: NostrEvent[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
    };
    const genesis = await createCommunity({ ownerPubkey: owner, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer: memberSigner,
      pubkey: member,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const t of genesis.controlRumors) community.controlStore.add(rumorFromTemplate(t, owner));
    await settle();

    // Grant the member KICK at position 5 — outranks a roleless member, but never
    // the owner (position 0, supreme/unremovable per CORD-04 §2).
    const roleId = "04".repeat(32);
    const role = {
      role_id: roleId,
      name: "Kicker",
      position: 5,
      permissions: PERM.KICK.toString(),
      scope: { kind: "server" },
      color: 0,
    };
    const roleEd = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });
    community.controlStore.add(rumorFromTemplate(roleEd, owner, 2_000));

    const grantEid = grantLocator(hexToBytes(genesis.material.community_id), member);
    const grantEd = await EditionFactory.create({
      vsk: VSK.GRANT,
      eid: grantEid,
      version: 1,
      content: JSON.stringify({ member, role_ids: [roleId] }),
    });
    community.controlStore.add(rumorFromTemplate(grantEd, owner, 3_000));
    await settle();
    expect(community.canDo(PERM.KICK)).toBe(true);

    // TEST-01: hand-derive the read-path decision (canActOn's shape — holds the
    // bit AND strictly outranks the target) independently of the local guard,
    // and confirm it topologically matches before asserting the throw.
    const actorStanding = community.standingOf(member);
    const targetStanding = community.standingOf(owner);
    const expectedAllowed =
      actorStanding.isOwner ||
      (hasPerm(actorStanding.permissions, PERM.KICK) && actorStanding.position < targetStanding.position);
    expect(expectedAllowed).toBe(false); // position 5 never outranks the owner (position 0)

    // The member (position 5) does not outrank the owner (position 0) — rejected
    // locally, before any publish (D-09, mirrors AUTH-02's refound() rejection).
    published.length = 0;
    await expect(community.kick(owner)).rejects.toThrow(/outrank|KICK/);
    expect(published).toEqual([]);

    // A roleless third party the mod DOES outrank — kick() proceeds and publishes.
    const target = "ee".repeat(32);
    await community.kick(target);
    await settle();
    const kicks = await Promise.resolve(community.guestbookStore.getTimeline([{ kinds: [3309] }]));
    expect(kicks.some((r) => r.tags.some((t) => t[0] === "p" && t[1] === target))).toBe(true);

    community.dispose();
  });

  it("canModerate$ refuses to act on yourself even holding every bit", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const owner = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({
      ownerPubkey: owner,
      name: "Test",
      description: "d",
      relays: ["wss://fake"],
    });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey: owner,
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const t of genesis.controlRumors) community.controlStore.add(rumorFromTemplate(t, owner));
    await settle();

    // The owner holds BAN outright, but can never outrank themselves.
    expect(community.canDo(PERM.BAN)).toBe(true);
    expect(await firstValueFrom(community.canModerate$(owner, PERM.BAN))).toBe(false);

    community.dispose();
  });

  it("roles$ stays quiet while channel traffic moves the member set", async () => {
    const { community } = await memberCommunity();

    let roleEmissions = 0;
    let memberEmissions = 0;
    const roleSub = community.roles$.subscribe(() => roleEmissions++);
    const memberSub = community.members$.subscribe(() => memberEmissions++);
    expect(roleEmissions).toBe(1);

    // A chat message re-runs the members/presence fold, so `state$` emits — but the
    // control slices keep their references, so a roles-driven UI must not re-render.
    const general = community.state$.value.channels.find((c) => c.name === "general")!;
    await community.sendMessage(general.channel_id, "hello");
    await settle();

    expect(memberEmissions).toBe(2); // the sender joins the observed member set
    expect(roleEmissions).toBe(1);

    roleSub.unsubscribe();
    memberSub.unsubscribe();
    community.dispose();
  });

  it("reports attachment upload progress per send", async () => {
    const uploader: ConcordUploader = {
      async upload(file, _communityId, options) {
        options?.onProgress?.("uploading");
        return { url: `https://cdn.example/${await file.text()}` };
      },
    };
    const { community } = await memberCommunity(uploader);
    const progress: string[] = [];
    const general = community.state$.value.channels.find((c) => c.name === "general")!;

    await community.sendMessage(general.channel_id, "files", undefined, [new Blob(["a"]), new Blob(["b"])], undefined, {
      onUploadProgress: (p) => progress.push(`${p.phase}:${p.done}/${p.total}`),
    });

    expect(progress).toEqual([
      "encrypting:0/2",
      "uploading:0/2",
      "uploading:1/2",
      "encrypting:1/2",
      "uploading:1/2",
      "uploading:2/2",
    ]);
    community.dispose();
  });
});
