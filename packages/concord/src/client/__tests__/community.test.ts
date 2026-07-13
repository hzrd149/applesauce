// ConcordCommunity over a dependency-injected EventStore/RelayPool — no network.
// A fake pool (inert request/subscription/sync streams) exercises the epoch-atomic
// sync (which completes against empty relays and opens a live subscription at the
// tip) plus the fold-via-models + optimistic local-echo path. Live relay behaviour
// is covered by the puppeteer drivers.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { normalizeURL } from "applesauce-core/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import type { RelayPool, RelayStatus } from "applesauce-relay";

import { kinds, type NostrEvent, type Rumor } from "applesauce-core/helpers/event";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import type { ConcordCommunityStatus } from "../../types.js";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { SnapshotFactory } from "../../factories/guestbook.js";
import { channelRekeyGroupKey, controlGroupKey } from "../../helpers/crypto.js";
import { unlockDirectInvite } from "../../helpers/direct-invite.js";
import { PERM } from "../../types.js";
import { ConcordCommunity } from "../community.js";

// The control fold + sync are debounced/async; let them run before asserting.
const settle = () => new Promise((r) => setTimeout(r, 200));

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
    publish: async () => [],
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
    publish: async () => [],
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    expect(community.state$.value.metadata?.name).toBe("Test");
    const general = community.state$.value.channels.find((c) => c.name === "general");
    expect(general).toBeDefined();
    expect(community.state$.value.members.has(pubkey)).toBe(true); // owner is a member

    // Consumers read the channel store directly with the standard timeline API.
    let messages: Rumor[] = [];
    const sub = community.channelStore(general!.channel_id).timeline([{ kinds: [kinds.ChatMessage] }]).subscribe((m) => (messages = m));
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Create a private channel — mints its key + publishes the CHANNEL edition;
    // once it folds, the community spawns a ConcordPrivateChannel sub-engine.
    const channelId = await community.createChannel("secret", true);
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Two private channels — the grant must carry ONLY the named one, never the other.
    const secret = await community.createChannel("secret", true);
    const other = await community.createChannel("other", true);
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

  it("refound compacts control heads (seals recovered) and does not leak private-channel keys", async () => {
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();
    const channelId = await community.createChannel("secret", true);
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
    const newControlPk = controlGroupKey(hexToBytes(community.material.community_root), cid, community.material.root_epoch).pk;
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

  it("honors the new refounder's guestbook snapshot after a Refounding", async () => {
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // A retained member carried ONLY by a kind-3312 snapshot (never an author, so not
    // "observed") — its presence hinges entirely on the snapshot being trusted.
    const memberM = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
    const snapshot = await SnapshotFactory.create([pubkey, memberM], bytesToHex(generateSecretKey()), 1, 1, Date.now());
    await community.publishToPlane({ plane: "guestbook" }, snapshot, {});
    await settle();

    // Before a Refounding the epoch has no refounder → the snapshot is not honored.
    expect(community.material.refounder).toBeUndefined();
    expect(community.state$.value.members.has(memberM)).toBe(false);

    // Refounding mints a new epoch whose refounder is us; the fold rebinds to it so the
    // now-trusted snapshot seeds the full memberlist on the new epoch.
    await community.refound({ keep: [pubkey] });
    await settle();
    expect(community.material.refounder).toBe(pubkey);
    expect(community.state$.value.members.has(memberM)).toBe(true);

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
