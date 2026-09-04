// ConcordCommunity over a dependency-injected EventStore/RelayPool — no network.
// A fake pool (inert request/subscription/sync streams) exercises the epoch-atomic
// sync (which completes against empty relays and opens a live subscription at the
// tip) plus the fold-via-models + optimistic local-echo path. Live relay behaviour
// is covered by the puppeteer drivers.

import { describe, expect, it, vi } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Observable, Subject, Subscription, firstValueFrom } from "rxjs";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { normalizeURL } from "applesauce-core/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import { ChatMessageFactory } from "applesauce-common/factories";
import type { PublishResponse, Relay, RelayPool, RelayStatus } from "applesauce-relay";

import { getEventHash, kinds, type NostrEvent, type Rumor } from "applesauce-core/helpers/event";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";

import type { ConcordCommunityStatus } from "../../types.js";

import { createCommunity } from "../../helpers/community.js";
import { JoinLeaveFactory, SnapshotFactory } from "../../factories/guestbook.js";
import { EditionFactory } from "../../factories/control.js";
import { channelGroupKey, channelRekeyGroupKey, controlGroupKey, grantLocator } from "../../helpers/crypto.js";
import { computeEditionHash } from "../../helpers/editions.js";
import { unlockDirectInvite } from "../../helpers/direct-invite.js";
import { hasPerm } from "../../helpers/permissions.js";
import { INVITE_BUNDLE_KIND, getInviteBundle } from "../../helpers/invite-bundle.js";
import { bindToChannel } from "../../operations/channel.js";
import { includeMediaEncryption } from "../../operations/channel.js";
import { parseImeta } from "../../helpers/imeta.js";
import { PERM, VSK, type RumorTemplate } from "../../types.js";
import { ConcordCommunity, MissingChannelKeyError } from "../community.js";
import { createUserAuthHandler } from "../auth.js";
import type { ConcordUploader } from "../storage.js";
import {
  CORD_METADATA_CAPS,
  DELETE_KIND5_EXAMPLE,
  REACTION_KIND7_EXAMPLE,
  THREADED_REPLY_KIND1111_EXAMPLE,
  VOICE_PRESENCE_JOINED_EXAMPLE,
  VOICE_PRESENCE_LEFT_EXAMPLE,
  missingFixtureTags,
  multiByteStringOverBytes,
  substituteFixtureTags,
  tagValues,
  utf8Bytes,
} from "../../__tests__/cord-wire-fixtures.js";
import { decodeWrap } from "../../helpers/gift-wrap.js";

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
  it("decrypts each historical attachment with its own imeta key after refounding", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const channelId = community.state$.value.channels.find((c) => c.name === "general")!.channel_id;
    const encrypt = async (url: string, plaintext: string) => {
      const key = generateSecretKey();
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const cryptoKey = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cryptoKey, new TextEncoder().encode(plaintext));
      return { url, plaintext, ciphertext, key: bytesToHex(key), nonce: bytesToHex(nonce) };
    };
    const publish = async (attachment: Awaited<ReturnType<typeof encrypt>>, epoch: number) => {
      let draft = await ChatMessageFactory.create(attachment.url).attachments([
        { url: attachment.url, type: "application/octet-stream" },
      ]);
      draft = await includeMediaEncryption([
        { url: attachment.url, algorithm: "aes-gcm", key: attachment.key, nonce: attachment.nonce },
      ])(draft);
      await community.publishToPlane({ plane: "channel", channelId }, await bindToChannel(channelId, epoch)(draft), {});
    };

    const before = await encrypt("https://media.test/before", "before refounding");
    const oldRoot = community.material.community_root;
    const oldEpoch = community.material.root_epoch;
    await publish(before, oldEpoch);
    await community.refound({ keep: [pubkey] });
    const after = await encrypt("https://media.test/after", "after refounding");
    const newRoot = community.material.community_root;
    const newEpoch = community.material.root_epoch;
    await publish(after, newEpoch);
    await settle();

    const messages = community.channelStore(channelId).getTimeline([{ kinds: [kinds.ChatMessage] }]);
    const parsed = new Map(messages.flatMap((message) => [...parseImeta(message.tags)]));
    const decrypt = async (fixture: typeof before) => {
      const encryption = parsed.get(fixture.url)!.encryption!;
      const key = await crypto.subtle.importKey("raw", hexToBytes(encryption.key), "AES-GCM", false, ["decrypt"]);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: hexToBytes(encryption.nonce) },
        key,
        fixture.ciphertext,
      );
      return new TextDecoder().decode(plaintext);
    };

    expect(await decrypt(before)).toBe(before.plaintext);
    expect(await decrypt(after)).toBe(after.plaintext);
    expect([before.key, before.nonce]).not.toEqual([after.key, after.nonce]);
    const cid = hexToBytes(community.material.community_id);
    const channelSecrets = [
      oldRoot,
      newRoot,
      bytesToHex(channelGroupKey(hexToBytes(oldRoot), cid, oldEpoch).convKey),
      bytesToHex(channelGroupKey(hexToBytes(newRoot), cid, newEpoch).convKey),
    ];
    expect(channelSecrets).not.toContain(before.key);
    expect(channelSecrets).not.toContain(after.key);
    const wrong = parsed.get(after.url)!.encryption!;
    const wrongKey = await crypto.subtle.importKey("raw", hexToBytes(wrong.key), "AES-GCM", false, ["decrypt"]);
    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv: hexToBytes(wrong.nonce) }, wrongKey, before.ciphertext),
    ).rejects.toThrow();

    community.dispose();
  });

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

  it("createChannel rejects an over-cap multi-byte name before minting a key or publishing an edition (WIRE-06/D-02)", async () => {
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
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();
    published.length = 0;

    // Cap number sourced from CORD_METADATA_CAPS (CORD-02 §6), never from
    // `helpers/caps.ts`'s own NAME_MAX_BYTES (D-21/TEST-01).
    const overCapName = multiByteStringOverBytes(CORD_METADATA_CAPS.nameBytes);
    await expect(community.createChannel(overCapName, { private: true })).rejects.toThrow(
      new RegExp(`${utf8Bytes(overCapName)}\\D+${CORD_METADATA_CAPS.nameBytes}`),
    );
    await settle();

    // No channel key was minted for the rejected channel.
    expect(community.material.channels).toHaveLength(0);
    // No channel edition was published as a result.
    expect(published.length).toBe(0);
    expect(community.state$.value.channels.some((c) => c.name === overCapName)).toBe(false);

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

    // A genuine, sig-less Rumor: react/replyToThread/deleteMessage now all take the
    // full target rumor (WIRE-03/04/05), so a stale `{ id, author }` fixture here
    // would silently stop exercising the shape those methods require — neither
    // `tsc` (this file is excluded from typechecking) nor this test's own runtime
    // path (the guard throws before the factory runs) would catch that regression.
    // Non-9 kind + non-empty tags so the fixture is also a genuine `"tags" in parent`
    // discriminant for `setParent`.
    const target: Rumor = {
      id: "0".repeat(64),
      pubkey,
      kind: 1111,
      content: "",
      tags: [["e", "1".repeat(64)]],
      created_at: Math.floor(Date.now() / 1000),
    };
    const invocations: Array<[string, () => Promise<void>]> = [
      ["react", () => community.react(channelId, target, "+")],
      ["editMessage", () => community.editMessage(channelId, target.id, "x")],
      ["deleteMessage", () => community.deleteMessage(channelId, target)],
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

  it("refreshInviteBundles skips a link that can't rebuild and still refreshes the rest (INVITE-03/D-11)", async () => {
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
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const secret = await community.createChannel("secret", { private: true });
    await settle();

    // Link A grants the private channel; link B grants nothing (always rebuildable).
    const linkA = await community.createInvite({ base: "https://x.io", label: "A", channels: [secret] });
    const linkB = await community.createInvite({ base: "https://x.io", label: "B" });
    await settle();

    // Voluntarily leave the channel: link A now references a channel we no longer
    // hold a key for, so its rebuild's `buildInviteBundle` throws "not a private
    // channel we hold a key for" (helpers/invite-bundle.ts:178).
    await community.leaveChannel(secret);

    published.length = 0;
    // Non-vacuity: under the OLD unguarded loop, link A's throw aborts the whole
    // for-loop, so link B (which comes after it) would never be rebuilt/published
    // either — this call would reject and `refreshedB` below would be undefined.
    await expect(community.refreshInviteBundles([linkA, linkB])).resolves.toBeUndefined();

    const refreshedA = published.find((e) => e.kind === INVITE_BUNDLE_KIND && e.pubkey === linkA.signerPubkey);
    const refreshedB = published.find((e) => e.kind === INVITE_BUNDLE_KIND && e.pubkey === linkB.signerPubkey);
    expect(refreshedA).toBeUndefined();
    expect(refreshedB).toBeDefined();

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
    const keys = (community as unknown as { keys: { material: { held_roots: Array<{ epoch: number; key: string }> } } })
      .keys;
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
    community
      .channelStore(general.channel_id)
      .add(rumorFromTemplate({ kind: 9, content: "hi", tags: [] }, memberX, 1_000));
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

  it("pins the observed-authors consumer set to {current-epoch guestbook, channel:*}", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: ["wss://fake"] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Touch the channel store so a `channel:` key exists in the private map.
    const general = community.state$.value.channels.find((c) => c.name === "general")!;
    community.channelStore(general.channel_id);

    const stores = (community as unknown as { stores: Map<string, { add: (r: Rumor) => unknown }> }).stores;

    // Derive the expected partition independently from the documented contract
    // (client/community.ts rewireState comment), not by reading its expression:
    // a store is an observed input iff its plane key starts with `channel:` or
    // equals the CURRENT-epoch guestbook key. The guestbook clause is
    // current-epoch-scoped on purpose (ROTATE-04 / D-01/D-02) — a stale-epoch
    // guestbook store is NOT an observed input.
    const currentGuestbookKey = `guestbook@${community.epoch$.value}`;
    const isObservedPlane = (key: string) => key.startsWith("channel:") || key === currentGuestbookKey;

    const liveKeys = [...stores.keys()];
    // Guard the sample space: a degenerate map (all-observed or all-unobserved)
    // would pass silently below, mirroring the anti-vacuity checks in
    // cord-citations.test.ts.
    expect(liveKeys.some(isObservedPlane)).toBe(true);
    expect(liveKeys.some((key) => !isObservedPlane(key))).toBe(true);

    // Mint one fresh pubkey per live store key and add one durable (kind 9)
    // rumor authored by it into that store — non-observed keys first, observed
    // keys last, so the final `state$` emission provably postdates every add.
    const authorFor = new Map<string, string>();
    for (const key of liveKeys) authorFor.set(key, await new PrivateKeySigner(generateSecretKey()).getPublicKey());

    const nonObserved = liveKeys.filter((key) => !isObservedPlane(key));
    const observed = liveKeys.filter(isObservedPlane);
    for (const key of [...nonObserved, ...observed]) {
      stores.get(key)!.add(rumorFromTemplate({ kind: 9, content: "hi", tags: [] }, authorFor.get(key)!, 5_000));
    }
    await settle();

    // One loop covers both directions: a widening makes the control/dissolved
    // author appear, a narrowing makes the channel/guestbook author disappear.
    for (const key of liveKeys) {
      expect(community.state$.value.members.has(authorFor.get(key)!)).toBe(isObservedPlane(key));
    }

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

    // A relay socket opens → connected flips.
    const url = normalizeURL("wss://fake");
    status$.next({ [url]: mkStatus({ url, connected: true }) });
    expect(snap?.connected).toBe(true);

    sub.unsubscribe();
    community.dispose();
  });
});

// TEST-01 (ROADMAP Phase 11 success criterion 6): every assertion in this block
// binds to the vendored `cord-wire-fixtures.ts` module — never to a snapshot of
// our own output. See 11-05-PLAN.md's non-vacuity traps: WIRE-03 must exercise a
// NON-9 reaction target, WIRE-04 needs a depth-2 chain, WIRE-05's delete target
// must be a genuine sig-less Rumor.
describe("wire conformance", () => {
  // Shared fixture: a fresh community with one public "general" channel, ready
  // to publish channel-plane rumors into. Every case below starts from this
  // exact setup rather than duplicating it inline.
  async function setupWireConformance() {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    // Captures every published wrap (kind-5 delete rumors are intercepted by
    // EventStore.add's delete-tracking branch and never land in a queryable
    // timeline, so WIRE-05's cases decode the wrap directly instead).
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

    const channelId = community.state$.value.channels.find((c) => c.name === "general")!.channel_id;
    const rootEpoch = community.material.root_epoch;
    return { community, channelId, pubkey, rootEpoch, published };
  }

  // The newest rumor of `kind` in `channelId`'s store. `getTimeline` returns a
  // descending (newest-first) list, so index 0 is the just-published rumor —
  // correct as long as at most one rumor of that kind exists at that point.
  function newestOfKind(community: ConcordCommunity, channelId: string, kind: number): Rumor {
    const [newest] = community.channelStore(channelId).getTimeline([{ kinds: [kind] }]);
    if (!newest) throw new Error(`no rumor of kind ${kind} found in channel ${channelId}`);
    return newest;
  }

  // Selects by content where two rumors of the same kind coexist (same-second
  // created_at ties make newest-first ordering alone ambiguous).
  function rumorWithContent(community: ConcordCommunity, channelId: string, kind: number, content: string): Rumor {
    const match = community
      .channelStore(channelId)
      .getTimeline([{ kinds: [kind] }])
      .find((r) => r.content === content);
    if (!match) throw new Error(`no rumor of kind ${kind} with content ${JSON.stringify(content)}`);
    return match;
  }

  // ---- WIRE-03: reaction "k" tag names the TARGET's real kind -----------

  it("WIRE-03: a reaction to a threaded reply names the reply's real kind (1111), not a hardcoded 9 (non-vacuous)", async () => {
    const { community, channelId } = await setupWireConformance();

    await community.sendMessage(channelId, "hello world");
    await settle();
    const message = newestOfKind(community, channelId, kinds.ChatMessage);

    await community.replyToThread(channelId, message, "replying in the thread");
    await settle();
    const reply = newestOfKind(community, channelId, kinds.Comment);

    // CORD_TARGET_KIND_RULE (cord-wire-fixtures.ts): the k tag a reaction
    // carries names the TARGET's kind — here the reply's 1111, not the
    // message's 9. A kind-9-target-only test cannot distinguish this from the
    // pre-fix hardcoded-9 behavior; see the Case B fixture-shape test below
    // for the divergence.
    await community.react(channelId, reply, "🔥");
    await settle();
    const reaction = newestOfKind(community, channelId, kinds.Reaction);

    const kValues = tagValues(reaction.tags, "k");
    expect(kValues).toHaveLength(1);
    expect(kValues[0]).toBe("1111");
    expect(tagValues(reaction.tags, "e")).toEqual([reply.id]);
    expect(tagValues(reaction.tags, "p")).toEqual([reply.pubkey]);

    community.dispose();
  });

  it("WIRE-03: a reaction to a kind-9 message matches examples.md §2.3 verbatim", async () => {
    const { community, channelId, rootEpoch } = await setupWireConformance();
    // A fresh community's root epoch is 0, matching the fixture's literal
    // "epoch" tag value verbatim — no substitution needed for that entry.
    expect(rootEpoch).toBe(0);

    await community.sendMessage(channelId, "hello world");
    await settle();
    const message = newestOfKind(community, channelId, kinds.ChatMessage);

    // Content is fixture-sourced on both sides of the comparison.
    await community.react(channelId, message, REACTION_KIND7_EXAMPLE.content);
    await settle();
    const reaction = newestOfKind(community, channelId, kinds.Reaction);

    // Only the "ms" entry is filtered out (a runtime clock remainder no
    // fixture can pin) — "channel"/"epoch" stay, bound to the real values.
    const expected = substituteFixtureTags(REACTION_KIND7_EXAMPLE.tags, {
      "<channel_id>": channelId,
      "<message rumor id>": message.id,
      "<message author>": message.pubkey,
    }).filter((tag) => tag[0] !== "ms");

    // Order-independent: bindToChannel appends channel/epoch/ms AFTER the
    // factory's own tags, so a positional whole-array comparison would pin
    // our own composition order rather than the (non-normative) spec.
    expect(missingFixtureTags(reaction.tags, expected)).toEqual([]);
    expect(reaction.kind).toBe(REACTION_KIND7_EXAMPLE.kind);
    expect(reaction.content).toBe(REACTION_KIND7_EXAMPLE.content);

    community.dispose();
  });

  // ---- WIRE-04: threaded reply root/parent tags --------------------------

  it("WIRE-04: a depth-1 reply to a kind-9 message matches examples.md §2.2 verbatim", async () => {
    const { community, channelId } = await setupWireConformance();

    await community.sendMessage(channelId, "hello world");
    await settle();
    const message = newestOfKind(community, channelId, kinds.ChatMessage);

    await community.replyToThread(channelId, message, THREADED_REPLY_KIND1111_EXAMPLE.content);
    await settle();
    const reply1 = newestOfKind(community, channelId, kinds.Comment);

    // At depth 1 the immediate parent IS the root, so BOTH placeholder pairs
    // bind to the same message id/author. This also proves WIRE-04's "a reply
    // off a kind-9 message is expressible" half: before the fix, the hand-built
    // pointer hardcoded the forum-thread kind, so the uppercase K could never
    // equal the fixture's 9.
    const expected = substituteFixtureTags(THREADED_REPLY_KIND1111_EXAMPLE.tags, {
      "<channel_id>": channelId,
      "<thread root rumor id>": message.id,
      "<root author>": message.pubkey,
      "<immediate parent rumor id>": message.id,
      "<parent author>": message.pubkey,
    }).filter((tag) => tag[0] !== "ms");

    expect(missingFixtureTags(reply1.tags, expected)).toEqual([]);
    expect(reply1.kind).toBe(THREADED_REPLY_KIND1111_EXAMPLE.kind);
    expect(reply1.content).toBe(THREADED_REPLY_KIND1111_EXAMPLE.content);

    community.dispose();
  });

  it("WIRE-04: a depth-2 reply inherits the ROOT from the message, not from its immediate parent (D-03, non-vacuous)", async () => {
    const { community, channelId } = await setupWireConformance();

    await community.sendMessage(channelId, "hello world");
    await settle();
    const message = newestOfKind(community, channelId, kinds.ChatMessage);

    await community.replyToThread(channelId, message, "first reply");
    await settle();
    const reply1 = rumorWithContent(community, channelId, kinds.Comment, "first reply");

    await community.replyToThread(channelId, reply1, "second reply");
    await settle();
    const reply2 = rumorWithContent(community, channelId, kinds.Comment, "second reply");

    // CORD_REPLY_ROOT_INHERITANCE_RULE (cord-wire-fixtures.ts): "When the
    // parent is itself a reply, its uppercase root tags are inherited
    // verbatim, so the root stays stable at any nesting depth." reply1's own
    // root tags were themselves asserted against the §2.2 fixture above, so
    // this is not a self-assertion — comparing full tag ARRAYS (not just
    // index-1 values) so the four-element E tag's empty relay slot is included.
    const tagArray = (rumor: Rumor, name: string) => rumor.tags.find((t) => t[0] === name);
    expect(tagArray(reply2, "E")).toEqual(tagArray(reply1, "E"));
    expect(tagArray(reply2, "K")).toEqual(tagArray(reply1, "K"));
    expect(tagArray(reply2, "P")).toEqual(tagArray(reply1, "P"));

    // The root did NOT move to reply1 — both the positive identity and the
    // negative inequality. The negative is the assertion that fails under the
    // pre-fix silent re-rooting.
    expect(tagValues(reply2.tags, "E")).toEqual([message.id]);
    expect(tagValues(reply2.tags, "E")[0]).not.toBe(reply1.id);
    expect(tagValues(reply2.tags, "K")).toEqual(["9"]); // the ROOT's kind, not the parent's

    // Lowercase tags name the IMMEDIATE parent (reply1), never the root.
    expect(tagValues(reply2.tags, "e")).toEqual([reply1.id]);
    expect(tagValues(reply2.tags, "p")).toEqual([reply1.pubkey]);
    expect(tagValues(reply2.tags, "k")).toEqual(["1111"]);

    for (const name of ["E", "K", "P", "e", "k", "p"]) {
      expect(
        reply2.tags.filter((t) => t[0] === name),
        `${name} tag count`,
      ).toHaveLength(1);
    }

    community.dispose();
  });

  // ---- WIRE-05: delete "k" tag against a genuine sig-less Rumor ----------

  // kind-5 delete rumors are intercepted by EventStore.add's delete-tracking
  // branch (they are recorded in the store's internal DeleteManager, not
  // added to the queryable timeline) — decode the published wrap directly.
  // The general channel is public, so its plane key is deterministic from
  // community_root/root_epoch (CORD-03 §1), independent of anything this
  // test's target rumor derives from.
  function decodedChannelDelete(
    community: ConcordCommunity,
    channelId: string,
    published: readonly NostrEvent[],
  ): Rumor {
    const channelKey = channelGroupKey(
      hexToBytes(community.material.community_root),
      hexToBytes(channelId),
      community.material.root_epoch,
    );
    const wrap = published.find((e) => e.pubkey === channelKey.pk);
    if (!wrap) throw new Error("no channel-plane wrap found in published events");
    const decoded = decodeWrap(wrap, channelKey.convKey);
    if (!decoded) throw new Error("channel-plane wrap failed to decode");
    return decoded.rumor;
  }

  it("WIRE-05: delete of a genuine sig-less Rumor matches examples.md §2.4, with a real 64-hex e tag", async () => {
    const { community, channelId, published } = await setupWireConformance();

    await community.sendMessage(channelId, "hello world");
    await settle();
    const message = newestOfKind(community, channelId, kinds.ChatMessage);

    // Precondition WIRE-05 rests on (RESEARCH.md Pitfall 1): the target read
    // back from the store is a genuine Rumor with no `sig`. A target carrying
    // a `sig` would satisfy `isEvent` and route through `setDeleteEvents`'s
    // own `ensureKTag` branch, masking the very defect WIRE-05 closes.
    expect(typeof message.id).toBe("string");
    expect(typeof message.pubkey).toBe("string");
    expect(message.kind).toBe(kinds.ChatMessage);
    expect(Array.isArray(message.tags)).toBe(true);
    expect("sig" in message).toBe(false);

    published.length = 0;
    await community.deleteMessage(channelId, message);
    await settle();
    const deleteRumor = decodedChannelDelete(community, channelId, published);

    const expected = substituteFixtureTags(DELETE_KIND5_EXAMPLE.tags, {
      "<channel_id>": channelId,
      "<own message rumor id>": message.id,
    }).filter((tag) => tag[0] !== "ms");

    expect(missingFixtureTags(deleteRumor.tags, expected)).toEqual([]);
    expect(deleteRumor.kind).toBe(DELETE_KIND5_EXAMPLE.kind);
    expect(deleteRumor.content).toBe(DELETE_KIND5_EXAMPLE.content);

    // T-11-11 catch: an "e" tag built from a stringified whole-rumor object
    // (rather than `target.id`) would not be a bare 64-hex id.
    const eValues = tagValues(deleteRumor.tags, "e");
    expect(eValues).toHaveLength(1);
    expect(eValues[0]).toBe(message.id);
    expect(eValues[0]).toHaveLength(64);

    community.dispose();
  });

  it("WIRE-05: delete of a kind-1111 reply names the reply's real kind, not the message's (CORD_TARGET_KIND_RULE)", async () => {
    const { community, channelId, published } = await setupWireConformance();

    await community.sendMessage(channelId, "hello world");
    await settle();
    const message = newestOfKind(community, channelId, kinds.ChatMessage);

    await community.replyToThread(channelId, message, "a reply to delete");
    await settle();
    const reply = newestOfKind(community, channelId, kinds.Comment);
    expect("sig" in reply).toBe(false);

    // CORD_TARGET_KIND_RULE (cord-wire-fixtures.ts): the k tag a delete
    // carries names the target's real kind — 1111 for a reply, not 9.
    published.length = 0;
    await community.deleteMessage(channelId, reply);
    await settle();
    const deleteRumor = decodedChannelDelete(community, channelId, published);

    const kValues = tagValues(deleteRumor.tags, "k");
    expect(kValues).toHaveLength(1);
    expect(kValues[0]).toBe("1111");

    community.dispose();
  });

  // ---- WIRE-02: voice presence (kind 23313) reaches the community receive path ----

  it("WIRE-02: voice presence (kind 23313) is readable from the channel store and matches examples.md §2.8 (non-vacuous)", async () => {
    const { community, channelId } = await setupWireConformance();

    // The non-binding entries of each fixture — channel/epoch/ms are excluded
    // because bindToChannel (inside sendEvent) stamps those itself.
    const joinedTags = VOICE_PRESENCE_JOINED_EXAMPLE.tags
      .filter((t) => !["channel", "epoch", "ms"].includes(t[0]!))
      .map((t) => [...t]);
    const leftTags = VOICE_PRESENCE_LEFT_EXAMPLE.tags
      .filter((t) => !["channel", "epoch", "ms"].includes(t[0]!))
      .map((t) => [...t]);

    await community.sendEvent(
      channelId,
      {
        kind: VOICE_PRESENCE_JOINED_EXAMPLE.kind,
        content: VOICE_PRESENCE_JOINED_EXAMPLE.content,
        tags: joinedTags,
        created_at: 0,
      },
      {},
    );
    // CORD-07 §4's joined and left forms carry different tag counts (left has
    // no identity/broker entries) — exercised alongside joined.
    await community.sendEvent(
      channelId,
      {
        kind: VOICE_PRESENCE_LEFT_EXAMPLE.kind,
        content: VOICE_PRESENCE_LEFT_EXAMPLE.content,
        tags: leftTags,
        created_at: 0,
      },
      {},
    );
    await settle();

    const presence = community.channelStore(channelId).getTimeline([{ kinds: [23313] }]);
    expect(presence).toHaveLength(2);
    expect(presence.map((r) => r.content).sort()).toEqual(["joined", "left"]);

    // Transit-integrity control: the stored "joined" rumor's tags still match
    // the fixture. Our own template carried the fixture's identity/broker
    // entries through unmodified (including the literal placeholder text), so
    // the SFU-identity placeholder binds to itself here — only channel_id is a
    // genuine runtime value.
    const joined = rumorWithContent(community, channelId, 23313, VOICE_PRESENCE_JOINED_EXAMPLE.content);
    const expected = substituteFixtureTags(VOICE_PRESENCE_JOINED_EXAMPLE.tags, {
      "<channel_id>": channelId,
      "<SFU identity>": "<SFU identity>",
    }).filter((tag) => tag[0] !== "ms");
    expect(missingFixtureTags(joined.tags, expected)).toEqual([]);

    community.dispose();
  });

  it("WIRE-02: a voice-presence rumor bound to a DIFFERENT channel is dropped by the anti-replay binding guard (non-vacuous)", async () => {
    const { community, channelId, rootEpoch } = await setupWireConformance();

    // A legitimate presence rumor on the target channel — the control this
    // case proves the binding guard leaves untouched.
    const joinedTags = VOICE_PRESENCE_JOINED_EXAMPLE.tags
      .filter((t) => !["channel", "epoch", "ms"].includes(t[0]!))
      .map((t) => [...t]);
    await community.sendEvent(
      channelId,
      {
        kind: VOICE_PRESENCE_JOINED_EXAMPLE.kind,
        content: VOICE_PRESENCE_JOINED_EXAMPLE.content,
        tags: joinedTags,
        created_at: 0,
      },
      {},
    );
    await settle();

    // A second, genuinely distinct channel on the same community.
    const otherChannelId = await community.createChannel("voice-other");
    await settle();

    // Bound to the OTHER channel, then published (via the raw publishToPlane
    // path, which applies no binding of its own) onto the FIRST channel's
    // plane — the wrap lands on channelId while the rumor's own tags name
    // otherChannelId, which is exactly the cross-channel-replay shape the
    // CORD-03 checkChatBinding guard exists to catch.
    const mismatchedRumor = await bindToChannel(
      otherChannelId,
      rootEpoch,
    )({
      kind: VOICE_PRESENCE_JOINED_EXAMPLE.kind,
      content: VOICE_PRESENCE_JOINED_EXAMPLE.content,
      tags: [],
      created_at: 0,
    });
    await community.publishToPlane({ plane: "channel", channelId }, mismatchedRumor, {});
    await settle();

    // Only the legitimate rumor survived; the mismatched one was dropped.
    const presence = community.channelStore(channelId).getTimeline([{ kinds: [23313] }]);
    expect(presence).toHaveLength(1);
    expect(presence[0]!.content).toBe(VOICE_PRESENCE_JOINED_EXAMPLE.content);
    expect(tagValues(presence[0]!.tags, "channel")).toEqual([channelId]);

    community.dispose();
  });

  it("WIRE-10/D-14: deleteChannel preserves custom + an unrecognized top-level key on the RAW published edition, excluding channel_id/key/epoch", async () => {
    const { community, published } = await setupWireConformance();

    // A fresh public channel — `createChannel`'s options do not expose
    // arbitrary/`custom` fields, so a v2 edition carrying them is published
    // directly onto the control plane, chained to the v1 head.
    const channelId = await community.createChannel("temp");
    await settle();

    const v1Content = JSON.stringify({ name: "temp", private: false });
    const v1Hash = computeEditionHash({ vsk: VSK.CHANNEL, eid: channelId, version: 1, content: v1Content });
    const v2Content = JSON.stringify({
      name: "temp",
      private: false,
      custom: { extension: { nested: true } },
      future_flag: "unknown-to-this-client",
    });
    const v2 = await EditionFactory.create({
      vsk: VSK.CHANNEL,
      eid: channelId,
      version: 2,
      prevHash: v1Hash,
      content: v2Content,
    });
    await community.publishToPlane({ plane: "control" }, v2, { plaintext: true });
    await settle();

    // Confirm the fold actually adopted v2 before deleting — otherwise the
    // rest of this test would only prove the fold's preservation again, not
    // deleteChannel's.
    const folded = community.state$.value.channels.find((c) => c.channel_id === channelId);
    expect(folded?.custom).toEqual({ extension: { nested: true } });
    expect(folded?.future_flag).toBe("unknown-to-this-client");

    published.length = 0;
    await community.deleteChannel(channelId);
    await settle();

    // Decode the published deletion edition's RAW content — not read back
    // through the fold, which would let the denylist mask a wire leak (the
    // fold would strip a `key` field the edition genuinely carried, and the
    // test would pass while the wire document leaked).
    const rootEpoch = community.material.root_epoch;
    const controlConvKey = controlGroupKey(
      hexToBytes(community.material.community_root),
      hexToBytes(community.material.community_id),
      rootEpoch,
    ).convKey;
    const decodedEditions = published
      .map((w) => decodeWrap(w, controlConvKey))
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .filter(
        (d) =>
          tagValues(d.rumor.tags, "vsk").includes(String(VSK.CHANNEL)) &&
          tagValues(d.rumor.tags, "eid").includes(channelId),
      );
    expect(decodedEditions).toHaveLength(1);
    const raw = JSON.parse(decodedEditions[0]!.rumor.content) as Record<string, unknown>;
    const keys = Object.keys(raw);

    expect(raw.deleted).toBe(true);
    expect(raw.custom).toEqual({ extension: { nested: true } });
    expect(raw.future_flag).toBe("unknown-to-this-client");
    expect(raw.name).toBe("temp");
    expect(raw.private).toBe(false);
    expect(keys).not.toContain("channel_id");
    expect(keys).not.toContain("key");
    expect(keys).not.toContain("epoch");

    community.dispose();
  });

  it("CR-01: a public channel whose edition carries a non-boolean deleted is still registered as a live stream key, not silently dropped from sync", async () => {
    // Three of `client/community.ts`'s `deleted` consumers share the same
    // loose-truthiness predicate (`!c.deleted`): `publicChannelKeys()` (:757),
    // `reconcileLive`'s `publicIds` (:807), and `reconcilePrivateChannels`
    // (:830, exercised by the next test). The fourth, `channels$` (:414-424),
    // applies NO `deleted` filter at all — that divergence is CR-01's impact.
    // Only `publicChannelKeys()`/`currentAuthors()` are driven directly here;
    // `reconcileLive`'s predicate is the identical expression over the same
    // folded value. The guarantee that makes all three gates correct lives in
    // the fold (12-10's rule tables — `deleted` is boolean-or-absent on every
    // folded `ChannelMetadata`), deliberately NOT duplicated into the gates
    // themselves by tightening them to `=== true` (see 12-11-SUMMARY.md).
    const { community, rootEpoch } = await setupWireConformance();

    // Created through the real API so each channel mints real key material —
    // a missing pubkey later cannot be blamed on absent key material.
    const hostileName = "hostile-cr01";
    const deadName = "dead-cr01";
    const liveName = "live-cr01";
    const hostileId = await community.createChannel(hostileName);
    const deadId = await community.createChannel(deadName);
    const liveId = await community.createChannel(liveName);
    await settle();

    async function publishV2(channelId: string, name: string, deleted: unknown): Promise<void> {
      const v1Content = JSON.stringify({ name, private: false });
      const v1Hash = computeEditionHash({ vsk: VSK.CHANNEL, eid: channelId, version: 1, content: v1Content });
      const v2Content = JSON.stringify({ name, private: false, deleted });
      const v2 = await EditionFactory.create({
        vsk: VSK.CHANNEL,
        eid: channelId,
        version: 2,
        prevHash: v1Hash,
        content: v2Content,
      });
      await community.publishToPlane({ plane: "control" }, v2, { plaintext: true });
    }

    // HOSTILE: the exact reproduction from 12-REVIEW.md — a truthy non-`true`
    // string. DEAD: a genuine terminal deletion (the discriminating control).
    // LIVE: left at v1, untouched — the baseline.
    await publishV2(hostileId, hostileName, "false");
    await publishV2(deadId, deadName, true);
    await settle();

    // 1. Fold-level shape, briefly — the premise the rest of the test rests on.
    // Confirms v2 was actually adopted for HOSTILE before anything else is asserted.
    const foldedHostile = community.state$.value.channels.find((c) => c.channel_id === hostileId);
    expect(foldedHostile).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(foldedHostile!, "deleted")).toBe(false);
    expect(community.state$.value.channels.some((c) => c.channel_id === deadId)).toBe(false);
    expect(community.state$.value.channels.some((c) => c.channel_id === liveId)).toBe(true);

    // 2. Render parity — `channels$` applies no `deleted` filter (:414-424).
    let views: { channel_id: string }[] = [];
    const viewSub = community.channels$.subscribe((v) => (views = v));
    viewSub.unsubscribe();
    expect(views.some((c) => c.channel_id === hostileId)).toBe(true);
    expect(views.some((c) => c.channel_id === liveId)).toBe(true);
    expect(views.some((c) => c.channel_id === deadId)).toBe(false);

    // 3. The gate the contract names. Expected pubkeys are read off the
    // derived channel-key map (`this.keys.channels`) — a DIFFERENT code path
    // than `publicChannelKeys()` itself, so this cannot compare the
    // implementation to itself.
    const keysAccess = community as unknown as { keys: { channels: Map<string, { pk: string }> } };
    const gateAccess = community as unknown as {
      publicChannelKeys: () => { pk: string }[];
      currentAuthors: () => string[];
    };
    const expectedHostilePk = keysAccess.keys.channels.get(hostileId)!.pk;
    const expectedLivePk = keysAccess.keys.channels.get(liveId)!.pk;
    const registeredPks = gateAccess.publicChannelKeys().map((k) => k.pk);
    expect(registeredPks).toContain(expectedHostilePk);
    expect(registeredPks).toContain(expectedLivePk);

    // 4. The subscription actually covers it — `currentAuthors()` is exactly
    // what `openLive()` dials and registers with `signers` for NIP-42.
    const authors = gateAccess.currentAuthors();
    expect(authors).toContain(expectedHostilePk);

    // 5. The genuine-deletion control. This is what stops the test from
    // passing on a build that achieved reachability by ignoring `deleted`
    // altogether, which would resurrect a deleted channel and violate
    // CHAN-07. DEAD never gets a derived key at all (excluded before
    // `deriveConcordKeys` even sees it), so its would-be pubkey is computed
    // independently via `channelGroupKey` over the public derivation
    // (community_root/epoch) rather than read off any map.
    expect(keysAccess.keys.channels.has(deadId)).toBe(false);
    const expectedDeadPk = channelGroupKey(
      hexToBytes(community.material.community_root),
      hexToBytes(deadId),
      rootEpoch,
    ).pk;
    expect(authors).not.toContain(expectedDeadPk);

    community.dispose();
  });

  it("CR-01: a private channel whose edition carries a non-boolean deleted keeps its sub-engine, while a genuine deletion disposes it", async () => {
    const { community } = await setupWireConformance();

    const hostileName = "hostile-private-cr01";
    const deadName = "dead-private-cr01";
    const hostileId = await community.createChannel(hostileName, { private: true });
    const deadId = await community.createChannel(deadName, { private: true });
    await settle();

    // Setup precondition: both private channels must already have a live
    // sub-engine before either v2 edition is published — otherwise the rest
    // of this test proves nothing.
    const engineAccess = community as unknown as { privateChannels: Map<string, unknown> };
    expect(engineAccess.privateChannels.has(hostileId)).toBe(true);
    expect(engineAccess.privateChannels.has(deadId)).toBe(true);

    async function publishV2(channelId: string, name: string, deleted: unknown): Promise<void> {
      const v1Content = JSON.stringify({ name, private: true });
      const v1Hash = computeEditionHash({ vsk: VSK.CHANNEL, eid: channelId, version: 1, content: v1Content });
      const v2Content = JSON.stringify({ name, private: true, deleted });
      const v2 = await EditionFactory.create({
        vsk: VSK.CHANNEL,
        eid: channelId,
        version: 2,
        prevHash: v1Hash,
        content: v2Content,
      });
      await community.publishToPlane({ plane: "control" }, v2, { plaintext: true });
    }

    // HOSTILE: a truthy non-`true` string `deleted` on a private channel's edition.
    await publishV2(hostileId, hostileName, "false");
    await settle();

    // Confirm v2 adopted — the fold-level premise and the adoption signal.
    const foldedHostile = community.state$.value.channels.find((c) => c.channel_id === hostileId);
    expect(foldedHostile).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(foldedHostile!, "deleted")).toBe(false);

    // The gate CR-01's third path names: with a truthy string `deleted`,
    // `reconcilePrivateChannels` (:830) would `continue` past the channel,
    // its id would drop out of the live set, and the existing engine would be
    // disposed — the private-channel half of "silently dead".
    expect(engineAccess.privateChannels.has(hostileId)).toBe(true);

    // DEAD: a genuine terminal deletion — the discriminating control, proving
    // the fix did not achieve engine retention by disabling deletion handling.
    await publishV2(deadId, deadName, true);
    await settle();

    expect(engineAccess.privateChannels.has(deadId)).toBe(false);
    expect(community.state$.value.channels.some((c) => c.channel_id === deadId)).toBe(false);

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

  it("editMetadata rejects an icon-only patch when the current (pre-existing) name is already over cap — the merge bypass D-03 names", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const owner = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: owner, name: "Test", relays: ["wss://fake"] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey: owner,
      pool,
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Seed a LEGACY over-cap `name` directly into folded control state — the
    // way a document minted before this plan's write-side cap existed (or by
    // another implementation) could still arrive on the wire. `createCommunity`
    // itself now refuses to construct this, so the suite's established
    // controlStore.add(rumorFromTemplate(...)) seeding route is used instead
    // (mirrors this file's role/grant seeding above), chained to the genesis
    // METADATA edition's hash so the fold's contiguous-chain walk adopts it.
    const overCapName = multiByteStringOverBytes(CORD_METADATA_CAPS.nameBytes);
    const v1Content = JSON.stringify({ name: "Test", relays: ["wss://fake"] });
    const prevHash = computeEditionHash({
      vsk: VSK.METADATA,
      eid: genesis.material.community_id,
      version: 1,
      content: v1Content,
    });
    const legacyEdition = await EditionFactory.create({
      vsk: VSK.METADATA,
      eid: genesis.material.community_id,
      version: 2,
      prevHash,
      content: JSON.stringify({ name: overCapName, relays: ["wss://fake"] }),
    });
    community.controlStore.add(rumorFromTemplate(legacyEdition, owner, 2_000));
    await settle();
    expect(community.state$.value.metadata?.name).toBe(overCapName);

    // The icon-only patch re-publishes the MERGED document, which still
    // carries the pre-existing over-cap `name` — asserting against `patch`
    // alone would miss this; asserting against the merged `next` catches it.
    await expect(
      community.admin.editMetadata({ icon: { url: "https://x", key: "k", nonce: "n", hash: "h" } }),
    ).rejects.toThrow(new RegExp(`${utf8Bytes(overCapName)}\\D+${CORD_METADATA_CAPS.nameBytes}`));

    community.dispose();
  });

  it("an over-cap channel name arriving via an authorized edition still folds into channel state verbatim — D-04's deliberate read-path non-guarantee", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const owner = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({ ownerPubkey: owner, name: "Test", relays: ["wss://fake"] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey: owner,
      pool,
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // This is D-04's DELIBERATE override of ROADMAP criterion 1's "and
    // defensively on read" clause: the fold's only rejection idiom is
    // `continue`, and applying it to an over-cap name would drop the channel
    // entirely, converting a caps bug into a channel-availability bug — the
    // fold is the sole source of channel state. Truncating on read was also
    // rejected, since it would make two clients disagree about a channel's
    // name. verify-phase scores WIRE-06/criterion-1 on write-side enforcement
    // alone (Task 2), not on an absent read guard. `createChannel` cannot be
    // used to construct this fixture (it now enforces the cap itself), so an
    // authorized CHANNEL edition is fed directly into `controlStore`,
    // bypassing the write path exactly like Test 7's legacy metadata edition.
    const overCapName = multiByteStringOverBytes(CORD_METADATA_CAPS.nameBytes);
    const channelId = "cd".repeat(32);
    const channelEdition = await EditionFactory.create({
      vsk: VSK.CHANNEL,
      eid: channelId,
      version: 1,
      content: JSON.stringify({ name: overCapName, private: false }),
    });
    community.controlStore.add(rumorFromTemplate(channelEdition, owner, 2_000));
    await settle();

    const folded = community.state$.value.channels.find((c) => c.channel_id === channelId);
    expect(folded).toBeDefined();
    expect(folded!.name).toBe(overCapName);

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

  it("ban() rejects locally before any publish when the caller lacks BAN or does not outrank the target (AUTH-05)", async () => {
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
      eventStore: new EventStore(),
      relays: ["wss://fake"],
    });
    await community.start();
    for (const t of genesis.controlRumors) community.controlStore.add(rumorFromTemplate(t, owner));
    await settle();

    // Grant the member BAN at position 5 — outranks a roleless member, but never
    // the owner (position 0, supreme/unremovable per CORD-04 §2).
    const roleId = "05".repeat(32);
    const role = {
      role_id: roleId,
      name: "Banhammer",
      position: 5,
      permissions: PERM.BAN.toString(),
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
    expect(community.canDo(PERM.BAN)).toBe(true);

    // TEST-01: hand-derive the read-path decision independently of the local
    // guard, and confirm it topologically matches before asserting the throw.
    const actorStanding = community.standingOf(member);
    const targetStanding = community.standingOf(owner);
    const expectedAllowed =
      actorStanding.isOwner ||
      (hasPerm(actorStanding.permissions, PERM.BAN) && actorStanding.position < targetStanding.position);
    expect(expectedAllowed).toBe(false); // position 5 never outranks the owner (position 0)

    // The member (position 5) does not outrank the owner (position 0) — rejected
    // locally, before any publish, and the banlist stays untouched.
    published.length = 0;
    await expect(community.ban(owner)).rejects.toThrow(/outrank|BAN/);
    expect(published).toEqual([]);
    expect(community.state$.value.banlist.has(owner)).toBe(false);

    // A roleless third party the mod DOES outrank — ban() proceeds and publishes.
    const target = "ef".repeat(32);
    await community.ban(target);
    await settle();
    expect(community.state$.value.banlist.has(target)).toBe(true);

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

// Plan 12.3-07: reactivity/churn/auth/refounding-quorum tests for a LIVE extras
// source. These prove the failure modes the canary suite (plan 06) cannot see:
// a later extras emission actually reaching live sockets and status observables
// (D-08/D-09/D-11), a no-op emission not churning them (D-09), extras
// participating in stream-key AUTH (D-03), and refounding's quorum not moving
// in either direction (D-06/ROTATE-09).
describe("ConcordCommunity extras (transport-only relay merge) — reactivity, churn, auth, refounding quorum (D-03/D-06/D-07/D-08/D-09/D-11)", () => {
  /** Records every `subscription`/`publish`/`relay()` call's relay-TARGET
   *  argument, so these tests can assert on what was actually dialled rather
   *  than inferring it from source. Local to this describe block only — the
   *  shared `fakePool`/`fakePoolWithStatus` helpers above are untouched. */
  function extrasPool(): {
    pool: RelayPool;
    subscriptionTargets: string[][];
    publishTargets: string[][];
    relayCalls: string[];
    setPublishResponses: (fn: (relays: string[]) => PublishResponse[]) => void;
  } {
    const subscriptionTargets: string[][] = [];
    const publishTargets: string[][] = [];
    const relayCalls: string[] = [];
    let respond: (relays: string[]) => PublishResponse[] = (relays) => relays.map((from) => ({ ok: true, from }));
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
      status$: new Subject(),
      relay: (url: string) => {
        relayCalls.push(url);
        return relay;
      },
      subscription: (relays: string[]) => {
        subscriptionTargets.push([...relays]);
        return NEVER;
      },
      request: () => EMPTY,
      publish: async (relays: string[]) => {
        publishTargets.push([...relays]);
        return respond(relays);
      },
    } as unknown as RelayPool;
    return { pool, subscriptionTargets, publishTargets, relayCalls, setPublishResponses: (fn) => (respond = fn) };
  }

  // Distinct, non-overlapping hostnames per test group so no assertion can pass
  // by coincidence (a substring shared between a protocol relay and an extra).
  const EXTRAS_PROTOCOL_A = "wss://cmty-extras-proto-a.test";
  const EXTRAS_PROTOCOL_B = "wss://cmty-extras-proto-b.test";
  const EXTRAS_PROTOCOL_RELAYS = [EXTRAS_PROTOCOL_A, EXTRAS_PROTOCOL_B];
  const EXTRA_ONE = "wss://cmty-extras-extra-one.test";
  const EXTRA_TWO = "wss://cmty-extras-extra-two.test";

  it("a second extras emission changes the live subscription's relay target without restarting the engine (D-08/D-09/D-11)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, subscriptionTargets } = extrasPool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: EXTRAS_PROTOCOL_RELAYS });
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: EXTRAS_PROTOCOL_RELAYS,
      extraRelays: extras$,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const before = subscriptionTargets.at(-1)!;
    expect(subscriptionTargets.length).toBeGreaterThan(0);
    expect(before.some((u) => u.includes("extras-extra-one"))).toBe(true);
    expect(before.some((u) => u.includes("extras-proto-a"))).toBe(true);
    expect(before.some((u) => u.includes("extras-proto-b"))).toBe(true);

    // Push a SECOND, DIFFERENT extras value (D-11) — a first-value-only
    // resolver would leave the target frozen on EXTRA_ONE forever.
    extras$.next([EXTRA_TWO]);
    await settle();

    const after = subscriptionTargets.at(-1)!;
    expect(after).not.toBe(before);
    expect(after.some((u) => u.includes("extras-extra-two"))).toBe(true);
    expect(after.some((u) => u.includes("extras-extra-one"))).toBe(false);
    expect(after.some((u) => u.includes("extras-proto-a"))).toBe(true);
    expect(after.some((u) => u.includes("extras-proto-b"))).toBe(true);

    community.dispose();
  });

  it("an equal-content extras re-emission does not open a new live subscription (D-09 churn guard)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, subscriptionTargets } = extrasPool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: EXTRAS_PROTOCOL_RELAYS });
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE, EXTRA_TWO]);

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: EXTRAS_PROTOCOL_RELAYS,
      extraRelays: extras$,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const callCountBefore = subscriptionTargets.length;
    expect(callCountBefore).toBeGreaterThan(0);

    // Same members, different array instance AND order — must not tear down and
    // reopen the live socket.
    extras$.next([EXTRA_TWO, EXTRA_ONE]);
    await settle();

    expect(subscriptionTargets.length).toBe(callCountBefore);

    community.dispose();
  });

  it("connected$ re-derives against the newly merged set after a second extras emission (D-07/D-08/D-11)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, status$ } = fakePoolWithStatus();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: EXTRAS_PROTOCOL_RELAYS });
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: EXTRAS_PROTOCOL_RELAYS,
      extraRelays: extras$,
    });

    const seen: boolean[] = [];
    const sub = community.connected$.subscribe((v) => seen.push(v));
    expect(seen.at(-1)).toBe(false);

    // Push a SECOND, different extras value (D-11) — the merged set drops
    // EXTRA_ONE and picks up EXTRA_TWO.
    extras$.next([EXTRA_TWO]);

    // The OLD extra (no longer in the merged set) reports up; the protocol
    // relays stay down. A first-value-only resolver would still be checking
    // EXTRA_ONE and would read connected — this must stay false, proving the
    // re-derivation genuinely dropped EXTRA_ONE from the checked set.
    status$.next({
      [normalizeURL(EXTRAS_PROTOCOL_A)]: mkStatus({ url: EXTRAS_PROTOCOL_A, connected: false }),
      [normalizeURL(EXTRAS_PROTOCOL_B)]: mkStatus({ url: EXTRAS_PROTOCOL_B, connected: false }),
      [normalizeURL(EXTRA_ONE)]: mkStatus({ url: EXTRA_ONE, connected: true }),
    });
    expect(seen.at(-1)).toBe(false);

    // The NEW extra alone reports up — D-07's documented any-of consequence: an
    // always-up app-local extra reports "connected" while every community relay
    // is down.
    status$.next({
      [normalizeURL(EXTRAS_PROTOCOL_A)]: mkStatus({ url: EXTRAS_PROTOCOL_A, connected: false }),
      [normalizeURL(EXTRAS_PROTOCOL_B)]: mkStatus({ url: EXTRAS_PROTOCOL_B, connected: false }),
      [normalizeURL(EXTRA_TWO)]: mkStatus({ url: EXTRA_TWO, connected: true }),
    });
    expect(seen.at(-1)).toBe(true);

    sub.unsubscribe();
    community.dispose();
  });

  it("the epoch walk's per-relay backfill requests cover the extras endpoint as well as the protocol relays (D-03)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, relayCalls } = extrasPool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: EXTRAS_PROTOCOL_RELAYS });
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: EXTRAS_PROTOCOL_RELAYS,
      extraRelays: extras$,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // No per-relay auth-driver registration exists any more (D-01) — the sync
    // loader itself reaches each relay in the transport set via
    // `pool.relay(url).request(...)` for its own backfill sync, so this
    // asserts the merged transport set (protocol + extras) is what the walk
    // actually reads from, not a registration side effect.
    expect(relayCalls.length).toBeGreaterThan(0);
    expect(relayCalls.some((u) => u.includes("extras-proto-a"))).toBe(true);
    expect(relayCalls.some((u) => u.includes("extras-proto-b"))).toBe(true);
    expect(relayCalls.some((u) => u.includes("extras-extra-one"))).toBe(true);

    community.dispose();
  });

  // n = 3 relays; threshold = ⌈(n+1)/2⌉ = ⌈4/2⌉ = 2 — hand-derived (D-11),
  // identical arithmetic to the pre-existing root-roll majority-gate test
  // above, never read back from refound()'s own threshold computation.
  const REFOUND_PROTOCOL_A = "wss://cmty-refound-proto-a.test";
  const REFOUND_PROTOCOL_B = "wss://cmty-refound-proto-b.test";
  const REFOUND_PROTOCOL_C = "wss://cmty-refound-proto-c.test";
  const REFOUND_PROTOCOL_RELAYS = [REFOUND_PROTOCOL_A, REFOUND_PROTOCOL_B, REFOUND_PROTOCOL_C];
  const REFOUND_THRESHOLD = 2;
  const REFOUND_EXTRA = "wss://cmty-refound-extra.test";

  it("refounding succeeds with the pre-phase-passing protocol ack count while extras also acks — the denominator is not raised by extras (D-06)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], _event: NostrEvent) => responses;

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: REFOUND_PROTOCOL_RELAYS });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: REFOUND_PROTOCOL_RELAYS,
      extraRelays: [REFOUND_EXTRA],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Exactly `REFOUND_THRESHOLD` of the protocol relays ack, PLUS the extras
    // endpoint also acks (an always-acking extra). If the denominator had been
    // widened to include the extra, this SAME protocol ack count would now fall
    // short of a raised threshold and refound() would incorrectly reject.
    responses = [
      ...REFOUND_PROTOCOL_RELAYS.slice(0, REFOUND_THRESHOLD).map((from) => ({ ok: true, from })),
      ...REFOUND_PROTOCOL_RELAYS.slice(REFOUND_THRESHOLD).map((from) => ({ ok: false, from, message: "Timeout" })),
      { ok: true, from: REFOUND_EXTRA },
    ];

    await expect(community.refound({ keep: [pubkey] })).resolves.toBeUndefined();

    community.dispose();
  });

  it("refounding still throws when protocol acks fall one short of majority even though the extras endpoint acks — extras acks are not counted (D-06)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], _event: NostrEvent) => responses;

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: REFOUND_PROTOCOL_RELAYS });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: REFOUND_PROTOCOL_RELAYS,
      extraRelays: [REFOUND_EXTRA],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const priorEpoch = community.material.root_epoch;

    // Protocol acks fall ONE short of the threshold, while the extras endpoint
    // acks — if extras acks counted toward `okCount`, this would incorrectly
    // reach the threshold and refound() would wrongly succeed.
    responses = [
      ...REFOUND_PROTOCOL_RELAYS.slice(0, REFOUND_THRESHOLD - 1).map((from) => ({ ok: true, from })),
      ...REFOUND_PROTOCOL_RELAYS.slice(REFOUND_THRESHOLD - 1).map((from) => ({ ok: false, from, message: "Timeout" })),
      { ok: true, from: REFOUND_EXTRA },
    ];

    await expect(community.refound({ keep: [pubkey] })).rejects.toThrow(/majority/);
    expect(community.material.root_epoch).toBe(priorEpoch);

    community.dispose();
  });

  it("refounding's gated wraps publish to the merged transport set, including the extras endpoint (D-06 feature half)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, publishTargets, setPublishResponses } = extrasPool();
    setPublishResponses((relays) => relays.map((from) => ({ ok: true, from })));

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: REFOUND_PROTOCOL_RELAYS });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: REFOUND_PROTOCOL_RELAYS,
      extraRelays: [REFOUND_EXTRA],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    publishTargets.length = 0;
    await community.refound({ keep: [pubkey] });

    expect(publishTargets.length).toBeGreaterThan(0);
    for (const target of publishTargets) {
      expect(target.some((u) => u.includes("refound-extra"))).toBe(true);
      expect(target.some((u) => u.includes("refound-proto-a"))).toBe(true);
      expect(target.some((u) => u.includes("refound-proto-b"))).toBe(true);
      expect(target.some((u) => u.includes("refound-proto-c"))).toBe(true);
    }

    community.dispose();
  });

  // ── Gap closure (T-12.3-09-*): refound()'s threshold/attribution must both
  // derive from ONE deduplicated protocol set, and neither the relay-list
  // normalization nor the ack-attribution normalization may throw a raw parse
  // error in place of the intended majority-abort message.
  const DUP_RELAY = "wss://cmty-refound-dup.test";
  const DUP_RELAY_TRAILING = "wss://cmty-refound-dup.test/";
  const MALFORMED_RELAY = "";
  const MALFORMED_RELAY_2 = "   ";

  it("refound() completes when the protocol relay list has a trailing-slash duplicate and the deduplicated single relay acks (D-06/ROTATE-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const relays = [DUP_RELAY, DUP_RELAY_TRAILING];
    const pool = fakePool();
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], _event: NostrEvent) => responses;

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Only ONE relay (post-normalization dedupe) acks. The raw array has 2
    // entries (threshold ⌈3/2⌉=2, unreachable by a single ack); the deduplicated
    // set has 1 relay (threshold ⌈2/2⌉=1, reachable by this single ack).
    responses = [{ ok: true, from: DUP_RELAY }];

    await expect(community.refound({ keep: [pubkey] })).resolves.toBeUndefined();

    community.dispose();
  });

  it("refound() completes when the protocol relay list has an unparseable entry alongside two valid relays that both ack — no URL parse error (D-06/ROTATE-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const relays = [REFOUND_PROTOCOL_A, MALFORMED_RELAY, REFOUND_PROTOCOL_B];
    const pool = fakePool();
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], _event: NostrEvent) => responses;

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Both valid relays ack; the unparseable entry is silently dropped, never
    // thrown as a parse error in place of a resolved/rejected refound() call.
    responses = [
      { ok: true, from: REFOUND_PROTOCOL_A },
      { ok: true, from: REFOUND_PROTOCOL_B },
    ];

    await expect(community.refound({ keep: [pubkey] })).resolves.toBeUndefined();

    community.dispose();
  });

  it("refound() rejects with the majority-abort message (not a parse error) when the protocol relay list contains ONLY unparseable entries (D-06/ROTATE-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const relays = [MALFORMED_RELAY, MALFORMED_RELAY_2];
    const pool = fakePool();
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], _event: NostrEvent) => responses;

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // No valid relay can ever ack, so the quorum can never be satisfied — but
    // the failure MUST be the intended majority-abort message, never a raw
    // "Invalid URL" parse error surfacing from the relay-list normalization.
    responses = [];

    await expect(community.refound({ keep: [pubkey] })).rejects.toThrow(/majority/);

    community.dispose();
  });

  it("refound() rejects with the majority-abort message (not a TypeError) when a publish response's `from` is an empty string (D-06/ROTATE-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], _event: NostrEvent) => responses;

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: REFOUND_PROTOCOL_RELAYS });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: REFOUND_PROTOCOL_RELAYS,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // Every response carries `from: ""` (a hostile/malformed relay response) —
    // none can be attributed to the protocol set, so the quorum genuinely misses
    // majority. The failure must be the intended abort message, not a TypeError
    // surfacing from the ack-attribution normalization.
    responses = REFOUND_PROTOCOL_RELAYS.map(() => ({ ok: true, from: "" }));

    await expect(community.refound({ keep: [pubkey] })).rejects.toThrow(/majority/);

    community.dispose();
  });

  it("refound() rejects with the majority-abort message (not a TypeError) when a publish response omits `from` entirely (D-06/ROTATE-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    let responses: PublishResponse[] = [];
    (pool as unknown as { publish: unknown }).publish = async (_relays: string[], _event: NostrEvent) => responses;

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: REFOUND_PROTOCOL_RELAYS });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: REFOUND_PROTOCOL_RELAYS,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // `from` entirely absent (relay-supplied response missing the field).
    responses = REFOUND_PROTOCOL_RELAYS.map(() => ({ ok: true }) as unknown as PublishResponse);

    await expect(community.refound({ keep: [pubkey] })).rejects.toThrow(/majority/);

    community.dispose();
  });
});

// Gap closure (WR-04), re-derived for D-01/D-02: there is no per-relay auth
// driver any more — a relay is authenticated only in reactive response to its
// own `auth-required:` refusal of an operation that actually targets it
// (Task 1). The underlying question this suite protects is still meaningful,
// answered differently: a de-configured relay stops being TARGETED at all
// (so nothing ever asks it to authenticate), and re-adding it is targeted
// again; a no-op extras re-emission doesn't churn the live subscription.
describe("ConcordCommunity live-subscription transport narrowing — retarget on extras change, no churn on no-op (WR-04)", () => {
  const AUTH_PROTOCOL = "wss://cmty-auth-protocol.test";
  const AUTH_PROTOCOL_RELAYS = [AUTH_PROTOCOL];
  const AUTH_EXTRA = "wss://cmty-auth-extra.test";
  // The live subscription's target list is the merged transport set — already
  // normalized by `mergeRelaySets` (a trailing slash) — so the recorded
  // subscription's relay list carries the NORMALIZED form, never the raw
  // literal. Normalize these two constants once for every assertion below.
  const AUTH_PROTOCOL_KEY = normalizeURL(AUTH_PROTOCOL);
  const AUTH_EXTRA_KEY = normalizeURL(AUTH_EXTRA);

  /** Distinct relay objects per URL (unlike `extrasPool()` above, which shares
   *  one relay object for every URL), so a per-relay `authenticate` call can
   *  be attributed to the URL it was actually made against. `pool.subscription`
   *  records every call's `{ relays, filters, options }` and returns a
   *  duck-typed Observable whose `.subscribe()` captures the real
   *  `Subscription` object `openLive()` receives — so a test can assert
   *  `.closed` on exactly what the engine holds, without reaching into any
   *  private field. */
  function authDriverPool(): {
    pool: RelayPool;
    subscriptions: { relays: string[]; filters: unknown; options: Record<string, unknown> }[];
    liveSubs: Subscription[];
  } {
    const relays = new Map<string, ReturnType<typeof makeRelay>>();
    function makeRelay(url: string) {
      return {
        url,
        challenge: null,
        challenge$: new BehaviorSubject<string | null>(null),
        isAuthenticated: () => false,
        authenticate: vi.fn(async (signer: { getPublicKey: () => Promise<string> }) => {
          const pk = await signer.getPublicKey();
          return { ok: true, pubkey: pk, url } as unknown as PublishResponse;
        }),
        getSupported: async () => null,
        request: () => EMPTY,
        sync: () => EMPTY,
      };
    }
    const subscriptions: { relays: string[]; filters: unknown; options: Record<string, unknown> }[] = [];
    const liveSubs: Subscription[] = [];
    const pool = {
      status$: new Subject(),
      relay: (url: string) => {
        if (!relays.has(url)) relays.set(url, makeRelay(url));
        return relays.get(url)!;
      },
      subscription: (relayUrls: string[], filters: unknown, options: Record<string, unknown>) => {
        subscriptions.push({ relays: relayUrls, filters, options });
        return {
          subscribe: (observerOrNext: unknown) => {
            const sub = NEVER.subscribe(observerOrNext as never);
            liveSubs.push(sub);
            return sub;
          },
        } as unknown as Observable<NostrEvent>;
      },
      request: () => EMPTY,
      publish: okAll,
    } as unknown as RelayPool;
    return { pool, subscriptions, liveSubs };
  }

  it("removing a relay from the extras set stops targeting it, and re-adding it targets it again", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, subscriptions } = authDriverPool();

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: AUTH_PROTOCOL_RELAYS });
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: AUTH_PROTOCOL_RELAYS,
      extraRelays: extras$,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // ExtraRelays.merge's identity fast path (D-14) returns `relays()` UNCHANGED
    // (no normalization) once the extras set is empty, so membership is checked
    // through `normalizeURL` rather than the raw recorded strings.
    const latestUrls = () => subscriptions[subscriptions.length - 1].relays.map(normalizeURL);
    expect(latestUrls()).toContain(AUTH_EXTRA_KEY);
    expect(latestUrls()).toContain(AUTH_PROTOCOL_KEY);

    // Narrow the extras set — the extra relay leaves the transport.
    extras$.next([]);
    await settle();

    expect(latestUrls()).not.toContain(AUTH_EXTRA_KEY);
    expect(latestUrls()).toContain(AUTH_PROTOCOL_KEY);

    // Re-add: the extra relay is targeted again.
    extras$.next([AUTH_EXTRA]);
    await settle();

    expect(latestUrls()).toContain(AUTH_EXTRA_KEY);
    expect(latestUrls()).toContain(AUTH_PROTOCOL_KEY);

    // Direct replacement for the old teardown assertion: with no per-relay
    // driver mechanism left (D-01), and this DI'd pool never manufacturing an
    // `auth-required:` refusal, nothing ever asked the extra relay to
    // authenticate across the whole test — a relay only ever learns the
    // pubkeys an operation that actually reaches it names (T-15-08/CAUTH-02).
    expect(pool.relay(AUTH_EXTRA_KEY).authenticate).not.toHaveBeenCalled();

    community.dispose();
  });

  it("a re-emission with identical membership does not re-open the live subscription (no churn, D-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, subscriptions } = authDriverPool();

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: AUTH_PROTOCOL_RELAYS });
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: AUTH_PROTOCOL_RELAYS,
      extraRelays: extras$,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const countBefore = subscriptions.length;

    // A no-op re-emission — same membership, new array instance.
    extras$.next([AUTH_EXTRA]);
    await settle();

    // openLive()'s `sig` guard (Task 1) suppresses the re-open entirely.
    expect(subscriptions.length).toBe(countBefore);

    community.dispose();
  });

  it("dispose() closes the live subscription", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, liveSubs } = authDriverPool();

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: AUTH_PROTOCOL_RELAYS });
    const extras$ = new BehaviorSubject<string[]>([AUTH_EXTRA]);
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: AUTH_PROTOCOL_RELAYS,
      extraRelays: extras$,
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const sub = liveSubs[liveSubs.length - 1];
    expect(sub.closed).toBe(false);

    community.dispose();

    expect(sub.closed).toBe(true);
    // No auth machinery outlives it (D-01): there is no driver map, reference
    // count, or `challenge$` subscription left for `dispose()` to have missed.
  });
});

// ── Gap closure (WR-01, 12.3-12): a construction that throws must leave
// nothing attached to the app-supplied extras source, so the source's own
// subscriber count — not merely `.observed`'s boolean — must return to
// exactly zero.
/** A counting Observable stand-in for `extraRelays`: increments a counter on
 *  subscribe, delegates to an inner BehaviorSubject, and decrements on
 *  teardown — so a test can assert an exact hand-derived active-subscriber
 *  count rather than a boolean (`.observed`). */
function countingExtrasSource(initial: string[] = []): {
  source: Observable<string[]>;
  count: () => number;
} {
  const inner = new BehaviorSubject<string[]>(initial);
  let active = 0;
  const source = new Observable<string[]>((subscriber) => {
    active++;
    const sub = inner.subscribe(subscriber);
    return () => {
      active--;
      sub.unsubscribe();
    };
  });
  return { source, count: () => active };
}

describe("ConcordCommunity constructor — self-cleaning extras on throw (WR-01, 12.3-12)", () => {
  it("a construction that throws during key derivation leaves zero subscribers on the extras source; a successful construction leaves exactly one", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Test",
      description: "hi",
      relays: ["wss://fake"],
    });

    // Malformed AFTER buildInviteBundle/validateInviteBundle would run — this
    // targets the constructor's own tail, not the bundle validator (that's
    // Task 1's surface). `hexToBytes(material.community_root)` throws
    // synchronously inside `deriveConcordKeys`, immediately after `this.extras`
    // is constructed but before any other field exists.
    const throwingMaterial = { ...genesis.material, community_root: "not-hex" };
    const { source: throwingExtras, count: throwingCount } = countingExtrasSource([]);

    expect(
      () =>
        new ConcordCommunity({
          material: throwingMaterial,
          signer,
          pubkey,
          pool,
          eventStore: new EventStore(),
          relays: ["wss://fake"],
          extraRelays: throwingExtras,
        }),
    ).toThrow();
    // Non-vacuity: pre-fix, `this.extras = new ExtraRelays(options.extraRelays)`
    // subscribes to `throwingExtras` BEFORE the throwing `deriveConcordKeys`
    // call — nothing ever called `.dispose()` on the discarded half-built
    // instance, so the subscriber count would have stayed at 1 forever.
    expect(throwingCount()).toBe(0);

    // Non-vacuity guard against the test passing vacuously because the source
    // is never subscribed at all: a SUCCESSFUL construction against the same
    // kind of source must leave exactly one active subscriber.
    const { source: okExtras, count: okCount } = countingExtrasSource([]);
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: ["wss://fake"],
      extraRelays: okExtras,
    });
    expect(okCount()).toBe(1);
    community.dispose();
  });

  it("a successfully constructed community still releases its subscriber on dispose()", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const pool = fakePool();
    const genesis = await createCommunity({
      ownerPubkey: pubkey,
      name: "Test",
      description: "hi",
      relays: ["wss://fake"],
    });
    const { source: extras, count } = countingExtrasSource([]);

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: ["wss://fake"],
      extraRelays: extras,
    });
    expect(count()).toBe(1);

    community.dispose();
    // Guards against a regression where the new constructor failure path
    // double-disposes, or the success path stops disposing on dispose().
    expect(count()).toBe(0);
  });
});

// CAUTH-02 scoped-AUTH oracle + CAUTH-04 no-suppression assertions. DESIGN-DERIVED
// (15-VALIDATION.md § Requirement -> Oracle Map): no recording of the prior
// client-wide churn behavior was ever committed, so every expected value here is
// read off the operation's own declared requirement (the recorded filter's
// `authors`), never off any community method (`currentAuthors()` and friends stay
// unread by this file).
describe("ConcordCommunity scoped-AUTH oracle — CAUTH-01/02/04", () => {
  const AUTH_URL = "wss://cauth-oracle.test";

  /** One shared relay object (so two communities can be proven not to
   *  cross-authenticate against the SAME relay) whose `authenticate` is a
   *  `vi.fn` recording `{ pubkey, url }`. The pool records every
   *  `subscription()` call's `{ relays, filters, options }` and every
   *  `relay(url).request()` call's `{ filters, options }` — the two seams
   *  the oracle inspects. */
  function authOraclePool(): {
    pool: RelayPool;
    subscriptionCalls: { relays: string[]; filters: { authors?: string[] }[]; options: Record<string, unknown> }[];
    requestCalls: { filters: { authors?: string[] }[]; options: Record<string, unknown> }[];
    authCalls: { pubkey: string; url: string }[];
    authenticate: ReturnType<typeof vi.fn>;
  } {
    const subscriptionCalls: {
      relays: string[];
      filters: { authors?: string[] }[];
      options: Record<string, unknown>;
    }[] = [];
    const requestCalls: { filters: { authors?: string[] }[]; options: Record<string, unknown> }[] = [];
    const authCalls: { pubkey: string; url: string }[] = [];
    const authenticate = vi.fn(async (signer: { getPublicKey: () => Promise<string> }) => {
      const pk = await signer.getPublicKey();
      authCalls.push({ pubkey: pk, url: AUTH_URL });
      return { ok: true, pubkey: pk, url: AUTH_URL } as unknown as PublishResponse;
    });
    const relay = {
      url: AUTH_URL,
      challenge: null,
      challenge$: new BehaviorSubject<string | null>(null),
      isAuthenticated: () => false,
      authenticate,
      getSupported: async () => null,
      sync: () => EMPTY,
      request: (filters: unknown, options: Record<string, unknown> = {}) => {
        const fs = (Array.isArray(filters) ? filters : [filters]) as { authors?: string[] }[];
        requestCalls.push({ filters: fs, options });
        return EMPTY;
      },
    };
    const pool = {
      status$: new Subject(),
      relay: () => relay,
      subscription: (relays: string[], filters: unknown, options: Record<string, unknown> = {}) => {
        const fs = (Array.isArray(filters) ? filters : [filters]) as { authors?: string[] }[];
        subscriptionCalls.push({ relays, filters: fs, options });
        return NEVER;
      },
      request: (_relays: string[], filters: unknown) => relay.request(filters),
      publish: okAll,
    } as unknown as RelayPool;
    return { pool, subscriptionCalls, requestCalls, authCalls, authenticate };
  }

  /** Synthesizes a `RelayAuthContext`-shaped value the way a relay's own
   *  `auth-required:` refusal would (RAUTH-01's shape) — the ONLY input this
   *  file feeds a captured handler. `missingPubkeys` defaults to `authors`
   *  (the operation's own declared requirement) but can be overridden — the
   *  isolation test below deliberately widens it to a UNION with the OTHER
   *  community's authors, so the isolation guarantee under test is the
   *  handler's own registry lookup (T-15-09: a relay-named pubkey the scope
   *  holds no signer for gets no signature), not merely an echo of an
   *  already-narrow input. */
  function authRequiredCtx(pool: RelayPool, authors: string[], id: string, missingPubkeys: string[] = authors) {
    return {
      relay: pool.relay(AUTH_URL) as unknown as Relay,
      url: AUTH_URL,
      challenge: null,
      request: { verb: "REQ" as const, id, filters: [] },
      requirement: authors,
      missingPubkeys,
      reason: "auth-required",
    };
  }

  it("waitForAuth matches the filter's own authors, and invoking the captured handler authenticates exactly that scoped set (CAUTH-01)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, subscriptionCalls, authCalls } = authOraclePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: [AUTH_URL] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: [AUTH_URL],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const latest = subscriptionCalls[subscriptionCalls.length - 1]!;
    // Expected pubkey set is read off the recorded filter's OWN `authors`
    // array — never off `community.currentAuthors()` or any other
    // engine-internal accessor (TEST-01/CAUTH-02).
    const authors = latest.filters[0]!.authors!;
    expect(authors.length).toBeGreaterThan(0);
    expect(latest.options.waitForAuth).toEqual(authors); // CAUTH-01 half
    expect(typeof latest.options.onAuthRequired).toBe("function");

    const onAuthRequired = latest.options.onAuthRequired as (ctx: unknown) => Promise<void>;
    await onAuthRequired(authRequiredCtx(pool, authors, "sub-1"));

    expect(authCalls.map((c) => c.pubkey).sort()).toEqual([...authors].sort());

    community.dispose();
  });

  // Phase 17 RESID-01 supersedes Phase 15 WR-02's clear-on-recovery reading:
  // transient per-relay AUTH is operation/diagnostic state, so preventing it
  // from entering the fatal UI error surface is stronger than clearing it later.
  it("keeps rejected, thrown, and unanswered AUTH out of fatal UI error state (RESID-01)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, subscriptionCalls, authenticate } = authOraclePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: [AUTH_URL] });

    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: [AUTH_URL],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    // The walk finished cleanly — no stale error left over.
    expect(community.error$.value).toBeNull();
    expect(community.phase$.value).toBe("live");

    const latest = subscriptionCalls[subscriptionCalls.length - 1]!;
    const onAuthRequired = latest.options.onAuthRequired as (ctx: unknown) => Promise<void>;
    const authors = latest.filters[0]!.authors!;

    authenticate.mockResolvedValueOnce({ ok: false, message: "denied", from: AUTH_URL });
    await onAuthRequired(authRequiredCtx(pool, authors, "rejected"));
    expect(community.error$.value).toBeNull();

    authenticate.mockRejectedValueOnce(new Error("relay auth transport failed"));
    await onAuthRequired(authRequiredCtx(pool, authors, "thrown"));
    expect(community.error$.value).toBeNull();

    const unknownPubkey = "0".repeat(64);
    await onAuthRequired(authRequiredCtx(pool, [unknownPubkey], "live-1", [unknownPubkey]));
    expect(community.error$.value).toBeNull();
    expect(community.phase$.value).toBe("live");

    const status = await firstValueFrom(community.status$);
    expect(status.error).toBeNull();

    community.dispose();
  });

  it("still reports a genuine community sync failure through fatal UI state", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: [AUTH_URL] });
    const pool = fakePool();
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: [AUTH_URL],
    });
    (community as unknown as { syncContext: () => never }).syncContext = () => {
      throw new Error("fatal sync failure");
    };

    await community.start();

    expect(community.error$.value).toBe("fatal sync failure");
    expect(community.phase$.value).toBe("error");
    expect((await firstValueFrom(community.status$)).error).toBe("fatal sync failure");
    community.dispose();
  });

  it("two communities sharing one relay each authenticate only their own authors, and a reconnect cycle re-authenticates that same scoped set (CAUTH-02)", async () => {
    const signerA = new PrivateKeySigner(generateSecretKey());
    const pubkeyA = await signerA.getPublicKey();
    const signerB = new PrivateKeySigner(generateSecretKey());
    const pubkeyB = await signerB.getPublicKey();

    const { pool, subscriptionCalls, authCalls } = authOraclePool();

    const genesisA = await createCommunity({ ownerPubkey: pubkeyA, name: "A", relays: [AUTH_URL] });
    const communityA = new ConcordCommunity({
      material: genesisA.material,
      signer: signerA,
      pubkey: pubkeyA,
      pool,
      eventStore: new EventStore(),
      relays: [AUTH_URL],
    });
    await communityA.start();
    for (const rumor of genesisA.controlRumors)
      await communityA.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesisA.guestbookRumors) await communityA.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();
    const latestA = subscriptionCalls[subscriptionCalls.length - 1]!;
    const authorsA = latestA.filters[0]!.authors!;
    const handlerA = latestA.options.onAuthRequired as (ctx: unknown) => Promise<void>;

    const genesisB = await createCommunity({ ownerPubkey: pubkeyB, name: "B", relays: [AUTH_URL] });
    const communityB = new ConcordCommunity({
      material: genesisB.material,
      signer: signerB,
      pubkey: pubkeyB,
      pool,
      eventStore: new EventStore(),
      relays: [AUTH_URL],
    });
    await communityB.start();
    for (const rumor of genesisB.controlRumors)
      await communityB.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesisB.guestbookRumors) await communityB.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();
    const latestB = subscriptionCalls[subscriptionCalls.length - 1]!;
    const authorsB = latestB.filters[0]!.authors!;
    const handlerB = latestB.options.onAuthRequired as (ctx: unknown) => Promise<void>;

    // Anti-vacuity: both non-empty and disjoint — a fixture that produced two
    // empty author sets would otherwise satisfy "disjoint" trivially.
    expect(authorsA.length).toBeGreaterThan(0);
    expect(authorsB.length).toBeGreaterThan(0);
    expect(authorsA.some((pk) => authorsB.includes(pk))).toBe(false);

    // The `missingPubkeys` fed to each handler is the UNION of both
    // communities' authors — a relay-controlled input naming a pubkey the
    // scope does not hold gets no signature (T-15-09), regardless of what the
    // relay reports. This is what a shared, client-wide registry would fail:
    // with one registry answering for both scopes, A's handler would find B's
    // keys in ITS OWN map too and sign for them.
    const union = [...authorsA, ...authorsB];

    await handlerA(authRequiredCtx(pool, authorsA, "a-1", union));
    expect(authCalls.map((c) => c.pubkey).sort()).toEqual([...authorsA].sort());
    expect(authCalls.some((c) => authorsB.includes(c.pubkey))).toBe(false);

    await handlerB(authRequiredCtx(pool, authorsB, "b-1", union));
    const afterB = authCalls.slice(authCalls.length - authorsB.length);
    expect(afterB.map((c) => c.pubkey).sort()).toEqual([...authorsB].sort());
    expect(afterB.some((c) => authorsA.includes(c.pubkey))).toBe(false);

    // Reconnect: a second auth-required cycle on the SAME operation
    // re-authenticates the same scoped set again — never a union with B's.
    const beforeSecondA = authCalls.length;
    await handlerA(authRequiredCtx(pool, authorsA, "a-2", union));
    const secondACalls = authCalls.slice(beforeSecondA);
    expect(secondACalls.map((c) => c.pubkey).sort()).toEqual([...authorsA].sort());
    expect(secondACalls.some((c) => authorsB.includes(c.pubkey))).toBe(false);

    communityA.dispose();
    communityB.dispose();
  });

  it("the recorded live-subscription options leave authRetries/authTimeout undefined (D-05/CAUTH-04), and a second auth-required cycle is never suppressed", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, subscriptionCalls, authCalls } = authOraclePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: [AUTH_URL] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: [AUTH_URL],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const latest = subscriptionCalls[subscriptionCalls.length - 1]!;
    // D-05: omitting both selects the documented upstream defaults
    // (authRetries=1, authTimeout=30_000) rather than concord overriding them.
    expect(latest.options.authRetries).toBeUndefined();
    expect(latest.options.authTimeout).toBeUndefined();

    const authors = latest.filters[0]!.authors!;
    const handler = latest.options.onAuthRequired as (ctx: unknown) => Promise<void>;

    await handler(authRequiredCtx(pool, authors, "cycle-1"));
    const countAfterFirst = authCalls.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    // No dedupe/suppression of a second auth-required cycle (D-18).
    await handler(authRequiredCtx(pool, authors, "cycle-2"));
    expect(authCalls.length).toBeGreaterThan(countAfterFirst);

    community.dispose();
  });

  it("the sync path's per-relay request options carry waitForAuth matching that request's own authors and an onAuthRequired function", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, requestCalls } = authOraclePool();
    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: [AUTH_URL] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: [AUTH_URL],
    });
    await community.start();
    await settle();

    expect(requestCalls.length).toBeGreaterThan(0);
    const first = requestCalls[0]!;
    const authors = first.filters[0]!.authors!;
    expect(authors.length).toBeGreaterThan(0);
    expect(first.options.waitForAuth).toEqual(authors);
    expect(typeof first.options.onAuthRequired).toBe("function");

    community.dispose();
  });
});

describe("ConcordCommunity publish-answerability oracle — T-15-10 (15-05 Task 3)", () => {
  const PUB_AUTH_URL = "wss://publish-coverage.test";

  /** Like `authOraclePool` above, but `publish` is a RECORDER (captures
   *  `{ relays, event, options }` for every publish) rather than a bare
   *  `okAll` stub — `okAll` itself still supplies the response shape
   *  `refound()`'s majority gate depends on, so that shape must not change. */
  function publishCoveragePool(): {
    pool: RelayPool;
    recorded: { relays: string[]; event: NostrEvent; options: Record<string, unknown> }[];
    authCalls: { pubkey: string; url: string }[];
  } {
    const authCalls: { pubkey: string; url: string }[] = [];
    const recorded: { relays: string[]; event: NostrEvent; options: Record<string, unknown> }[] = [];
    const relay = {
      url: PUB_AUTH_URL,
      challenge: null,
      challenge$: new BehaviorSubject<string | null>(null),
      isAuthenticated: () => false,
      authenticate: vi.fn(async (signer: { getPublicKey: () => Promise<string> }) => {
        const pk = await signer.getPublicKey();
        authCalls.push({ pubkey: pk, url: PUB_AUTH_URL });
        return { ok: true, pubkey: pk, url: PUB_AUTH_URL } as unknown as PublishResponse;
      }),
      getSupported: async () => null,
      sync: () => EMPTY,
      request: () => EMPTY,
    };
    const pool = {
      status$: new Subject(),
      relay: () => relay,
      subscription: () => NEVER,
      request: () => EMPTY,
      publish: async (relays: string[], event: NostrEvent, options: Record<string, unknown> = {}) => {
        recorded.push({ relays, event, options });
        return okAll(relays);
      },
    } as unknown as RelayPool;
    return { pool, recorded, authCalls };
  }

  /** Synthesizes a `RelayAuthContext`-shaped value the same way the CAUTH-01/02/04
   *  oracle above does — the ONLY input this suite feeds a captured handler. */
  function authRequiredCtx(pool: RelayPool, missingPubkeys: string[] | null, id: string) {
    return {
      relay: pool.relay(PUB_AUTH_URL) as unknown as Relay,
      url: PUB_AUTH_URL,
      challenge: null,
      request: { verb: "EVENT" as const, id, filters: [] },
      requirement: missingPubkeys ?? true,
      missingPubkeys,
      reason: "auth-required",
    };
  }

  it("every publish a community makes declares an author its own holder can answer for, and the one NIP-59 grant answers with the user's key", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const member = new PrivateKeySigner(generateSecretKey());
    const memberPubkey = await member.getPublicKey();
    const { pool, recorded, authCalls } = publishCoveragePool();
    // The client-wide user handler this scenario's ConcordClient would have built
    // once (D-08) — passed through exactly as ConcordClient.addCommunity does.
    const userOnAuthRequired = createUserAuthHandler(signer, () => pubkey);

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: [PUB_AUTH_URL] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: [PUB_AUTH_URL],
      userOnAuthRequired,
    });
    await community.start();
    // Genesis publishes.
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const channelId = await community.createChannel("secret", { private: true });
    await settle();

    // A private-channel send (CR-01): the community itself publishes it (D-06 —
    // the sub-engine only reads), so this must be answerable by the community's
    // OWN holder. Captured independently of `community`'s internals — the record
    // this call appends to the recorder is the pool's own observation, not a
    // readback of `community`'s `StreamSigners`.
    const beforeSendCount = recorded.length;
    await community.sendMessage(channelId, "hi");
    await settle();
    expect(recorded.length).toBe(beforeSendCount + 1);
    const privateChannelSend = recorded[beforeSendCount]!;
    const privateChannelPubkey = privateChannelSend.event.pubkey;

    // An invite mint, refresh (against the still-live invite, WR-06), then revoke.
    const invite = await community.createInvite({ base: "https://example.com/join" });
    await settle();
    await community.refreshInviteBundles([invite]);
    await settle();
    await community.revokeInvite(invite);
    await settle();
    // The one NIP-59 Direct-Invite grant (D-16/D-17 exception).
    await community.grantChannelAccess(channelId, memberPubkey);
    await settle();
    // A channel rotation.
    await community.rotateChannel(channelId, { keep: [pubkey] });
    await settle();
    // refound() LAST (WR-06): rolls the epoch and adopts new key state, so
    // anything after it would be operating on a different epoch than the rest
    // of this scenario. Exercises all four refound() publish sites in one call:
    // the root-roll requireMajority publish, the channel-rekey requireMajority
    // publish (via channelRekeys), the compaction publish, and the snapshot
    // publish. A single PUB_AUTH_URL relay gives majorityThreshold = ceil((1+1)/2)
    // = 1, which the fixture's okAll ack clears.
    await community.refound({ keep: [pubkey], channelRekeys: [{ channelId, keep: [pubkey] }] });
    await settle();

    // Anti-vacuity: a scenario that silently published nothing cannot pass.
    // Raised to account for refreshInviteBundles and refound()'s four sites.
    expect(recorded.length).toBeGreaterThan(10);

    // The loop's universality claim is now a CHECKED PROPERTY, not a comment:
    // assert a lower bound on the number of DISTINCT publishing authors this
    // scenario exercised. Each of the following is a structurally distinct
    // `event.pubkey`: genesis control, genesis guestbook, the private channel's
    // message-plane key (the send), the invite-link key (shared by mint/refresh/
    // revoke — one author, three publishes), the NIP-59 grant's ephemeral key,
    // rotateChannel's new channel-rekey address, refound()'s root-roll address,
    // refound()'s bundled channel-rekey address (a second, later epoch than
    // rotateChannel's), refound()'s new-epoch control address (compaction), and
    // refound()'s new-epoch guestbook address (snapshot) — 10 distinct authors.
    // A future refactor that stops driving one of these sites shrinks this count
    // and fails here, rather than silently narrowing the oracle.
    const distinctAuthors = new Set(recorded.map((r) => r.event.pubkey));
    expect(distinctAuthors.size).toBeGreaterThanOrEqual(10);

    // Every recorded publish EXCEPT the Direct-Invite grant carries
    // `waitForAuth: [event.pubkey]` — matched structurally (on the grant's own
    // `waitForAuth: true` marker), not by enumerating sites, so a new publish
    // site added later without options fails this loop automatically.
    const streamRecords = recorded.filter((r) => r.options.waitForAuth !== true);
    const grantRecords = recorded.filter((r) => r.options.waitForAuth === true);
    expect(grantRecords.length).toBe(1);

    for (const record of streamRecords) {
      expect(record.options.waitForAuth).toEqual([record.event.pubkey]);
      expect(typeof record.options.onAuthRequired).toBe("function");
      // Answerability: the recorded handler can actually authenticate the author
      // it declared — reset the recorder so each publish's claim is checked
      // independently.
      authCalls.length = 0;
      const handler = record.options.onAuthRequired as (ctx: unknown) => Promise<void>;
      await handler(authRequiredCtx(pool, [record.event.pubkey], `pub-${record.event.id.slice(0, 8)}`));
      expect(authCalls.map((c) => c.pubkey)).toEqual([record.event.pubkey]);
    }

    // Named explicitly (CR-01): the private-channel send's pubkey specifically —
    // the structural loop above would not say WHICH publish broke if this
    // regressed. (a) it is the sole waitForAuth entry on its own recorded publish.
    expect(privateChannelSend.options.waitForAuth).toEqual([privateChannelPubkey]);
    // (b) invoking its own recorded handler authenticates exactly that pubkey —
    // proving the community's own StreamSigners holder (widened by CR-01's
    // heldChannelKeys()) can answer for it, not just that the loop above happened
    // to pass.
    authCalls.length = 0;
    const privateChannelHandler = privateChannelSend.options.onAuthRequired as (ctx: unknown) => Promise<void>;
    await privateChannelHandler(authRequiredCtx(pool, [privateChannelPubkey], "private-channel-send"));
    expect(authCalls.map((c) => c.pubkey)).toEqual([privateChannelPubkey]);

    // The Direct-Invite grant: waits on any authenticated user, answered by the
    // USER's own handler — never a stream key.
    const grant = grantRecords[0]!;
    expect(typeof grant.options.onAuthRequired).toBe("function");
    authCalls.length = 0;
    const grantHandler = grant.options.onAuthRequired as (ctx: unknown) => Promise<void>;
    await grantHandler(authRequiredCtx(pool, null, "grant-1"));
    expect(authCalls.map((c) => c.pubkey)).toEqual([pubkey]);

    // D-05: no recorded publish overrides the upstream auth-retry defaults.
    for (const record of recorded) {
      expect(record.options.authRetries).toBeUndefined();
      expect(record.options.authTimeout).toBeUndefined();
    }

    community.dispose();
  });

  // WR-01: `rotateChannel` must register the exact `GroupKey` `buildChannelRekey`
  // finalized the wraps with, not a second recomputation from `this.material`
  // taken after the build — that recomputation observes whatever `this.keys` is
  // pointing at BY THE TIME it runs, which a concurrent `adoptRefounding()`
  // (`checkRekey()`'s 200ms timer) can have rolled forward mid-flight. Reproduced
  // here by mutating the engine's key state (a same-shape reassignment of the
  // private `keys` field, the suite's established `as unknown as` convention —
  // plan 12.3-14 used the same mechanism to drive `handleRemoved`) from inside
  // `buildChannelRekey`'s own internal `nip44.encrypt` await, which is strictly
  // BETWEEN the wraps being sealed under the pre-mutation root and `rotateChannel`'s
  // post-build registration reading `this.material` again.
  it("rotateChannel registers the key that actually finalized the wraps, even if the community's root changes mid-flight (WR-01)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const pubkey = await signer.getPublicKey();
    const { pool, recorded, authCalls } = publishCoveragePool();

    const genesis = await createCommunity({ ownerPubkey: pubkey, name: "Test", relays: [PUB_AUTH_URL] });
    const community = new ConcordCommunity({
      material: genesis.material,
      signer,
      pubkey,
      pool,
      eventStore: new EventStore(),
      relays: [PUB_AUTH_URL],
    });
    await community.start();
    for (const rumor of genesis.controlRumors)
      await community.publishToPlane({ plane: "control" }, rumor, { plaintext: true });
    for (const rumor of genesis.guestbookRumors) await community.publishToPlane({ plane: "guestbook" }, rumor, {});
    await settle();

    const channelId = await community.createChannel("secret", { private: true });
    await settle();

    // Mutate the engine's key state to a DIFFERENT community root the moment
    // buildChannelRekey's own signer.nip44.encrypt is invoked — i.e., strictly
    // after buildChannelRekey has captured its `material` argument (protecting
    // the wraps' actual seal address) but before rotateChannel's post-build code
    // re-reads `this.material`.
    const keysAccess = community as unknown as {
      keys: { material: Record<string, unknown> } & Record<string, unknown>;
    };
    let mutated = false;
    const originalEncrypt = signer.nip44!.encrypt.bind(signer.nip44);
    const encryptSpy = vi.spyOn(signer.nip44!, "encrypt");
    encryptSpy.mockImplementation(async (pk: string, plain: string) => {
      if (!mutated) {
        mutated = true;
        const differentRoot = bytesToHex(generateSecretKey());
        const priorKeys = keysAccess.keys;
        keysAccess.keys = { ...priorKeys, material: { ...priorKeys.material, community_root: differentRoot } };
      }
      return originalEncrypt(pk, plain);
    });

    const beforeCount = recorded.length;
    await community.rotateChannel(channelId, { keep: [pubkey] });
    await settle();
    encryptSpy.mockRestore();

    const rekeyRecords = recorded.slice(beforeCount);
    expect(rekeyRecords.length).toBeGreaterThan(0);
    for (const record of rekeyRecords) {
      authCalls.length = 0;
      const handler = record.options.onAuthRequired as (ctx: unknown) => Promise<void>;
      await handler(authRequiredCtx(pool, [record.event.pubkey], `pub-${record.event.id.slice(0, 8)}`));
      expect(authCalls.map((c) => c.pubkey)).toEqual([record.event.pubkey]);
    }

    community.dispose();
  });
});
