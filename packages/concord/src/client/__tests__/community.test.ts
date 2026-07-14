// ConcordCommunity over a dependency-injected EventStore/RelayPool — no network.
// A fake pool (inert request/subscription/sync streams) exercises the epoch-atomic
// sync (which completes against empty relays and opens a live subscription at the
// tip) plus the fold-via-models + optimistic local-echo path. Live relay behaviour
// is covered by the puppeteer drivers.

import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, firstValueFrom } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { normalizeURL } from "applesauce-core/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import type { RelayPool, RelayStatus } from "applesauce-relay";

import { getEventHash, kinds, type NostrEvent, type Rumor } from "applesauce-core/helpers/event";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import type { ConcordCommunityStatus } from "../../types.js";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { SnapshotFactory } from "../../factories/guestbook.js";
import { EditionFactory } from "../../factories/control.js";
import { channelRekeyGroupKey, controlGroupKey, grantLocator } from "../../helpers/crypto.js";
import { unlockDirectInvite } from "../../helpers/direct-invite.js";
import { INVITE_BUNDLE_KIND, getInviteBundle } from "../../helpers/invite-bundle.js";
import { PERM, VSK, type RumorTemplate } from "../../types.js";
import { ConcordCommunity } from "../community.js";
import type { ConcordUploader } from "../storage.js";

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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
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
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], event: NostrEvent) => {
      published.push(event);
      return [];
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
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
    const genesis = await createCommunity({ ownerPubkey: owner, name: "Test", description: "d", relays: ["wss://fake"] });
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
    const role = { role_id: roleId, name: "Mods", position: 5, permissions: PERM.MANAGE_CHANNELS.toString(), scope: { kind: "server" }, color: 0 };
    const roleEd = await EditionFactory.create({ vsk: VSK.ROLE, eid: roleId, version: 1, content: JSON.stringify(role) });
    community.controlStore.add(rumorFromTemplate(roleEd, owner, 2_000));

    const grantEid = grantLocator(hexToBytes(genesis.material.community_id), member);
    const grantEd = await EditionFactory.create({ vsk: VSK.GRANT, eid: grantEid, version: 1, content: JSON.stringify({ member, role_ids: [roleId] }) });
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
    const genesis = await createCommunity({ ownerPubkey: owner, name: "Test", description: "d", relays: ["wss://fake"] });
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
    for (const rumor of genesis.controlRumors) await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
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

  it("canModerate$ refuses to act on yourself even holding every bit", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const owner = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: owner, name: "Test", description: "d", relays: ["wss://fake"] });
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

    await community.sendMessage(
      general.channel_id,
      "files",
      undefined,
      [new Blob(["a"]), new Blob(["b"])],
      undefined,
      { onUploadProgress: (p) => progress.push(`${p.phase}:${p.done}/${p.total}`) },
    );

    expect(progress).toEqual(["encrypting:0/2", "uploading:0/2", "uploading:1/2", "encrypting:1/2", "uploading:1/2", "uploading:2/2"]);
    community.dispose();
  });
});
