import { EventStore } from "applesauce-core";
import { finalizeEvent, getPublicKey, matchFilter, type Filter, type NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { InMemoryStorageAdapter } from "nostr-double-ratchet";
import { filter, firstValueFrom, map, merge, Observable, of, Subject, timeout } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MessageFileUploader } from "../../common/attachments.js";
import { NdrMessagesClient } from "../client.js";
import type { NdrMessage } from "../types.js";

const relays = ["wss://ndr.example.com/"];
const clients: NdrMessagesClient[] = [];

/** A single in-memory relay shared by every client in a test */
function createRelay() {
  const events = new Map<string, NostrEvent>();
  const live = new Subject<NostrEvent>();

  function stored(eventFilter: Filter) {
    return [...events.values()].filter((event) => matchFilter(eventFilter, event));
  }

  return {
    subscription: (_relays: string[], eventFilter: Filter) =>
      merge(of(...stored(eventFilter)), live.pipe(filter((event) => matchFilter(eventFilter, event)))),
    request: (_relays: string[], eventFilter: Filter) =>
      new Observable<NostrEvent>((subscriber) => {
        for (const event of stored(eventFilter)) subscriber.next(event);
        subscriber.complete();
      }),
    publish: async (_relays: string[], event: NostrEvent) => {
      // Replaceable rosters and invites keep only their newest revision, as relays do.
      if (event.kind >= 30000 && event.kind < 40000) {
        const d = event.tags.find((tag) => tag[0] === "d")?.[1];
        for (const [id, existing] of events) {
          const sameAddress =
            existing.kind === event.kind &&
            existing.pubkey === event.pubkey &&
            existing.tags.find((tag) => tag[0] === "d")?.[1] === d;
          if (sameAddress && existing.created_at <= event.created_at) events.delete(id);
        }
      }

      events.set(event.id, event);
      live.next(event);
      return [{ ok: true, from: relays[0] }];
    },
  };
}

/** An uploader that pretends to store blobs on a file server */
const upload: MessageFileUploader = async (blob) => ({
  url: `https://files.example.com/${blob.size}-${Math.random()}`,
});

function createClient(relay: ReturnType<typeof createRelay>, key: number, signed = true) {
  const secret = new Uint8Array(32).fill(key);
  const pubkey = getPublicKey(secret);
  const client = new NdrMessagesClient({
    pubkey,
    signer: signed ? new PrivateKeySigner(secret) : undefined,
    eventStore: new EventStore(),
    pool: relay as unknown as RelayPool,
    relays,
    storage: new InMemoryStorageAdapter(),
    fetchTimeoutMs: 200,
    appKeysTimeoutMs: 300,
    lockName: false,
    upload,
  });
  clients.push(client);
  return client;
}

async function register(client: NdrMessagesClient) {
  await client.start();
  const prepared = await client.prepareRegistration();
  await client.publishRegistration(prepared, "Test device");
}

function waitForMessage(messages$: Observable<NdrMessage[]>, match: (message: NdrMessage) => boolean) {
  return firstValueFrom(
    messages$.pipe(
      map((messages) => messages.find(match)),
      filter((message) => message !== undefined),
      timeout(5000),
    ),
  );
}

afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
  vi.unstubAllGlobals();
});

describe("NdrMessagesClient", () => {
  describe.each(["direct", "group"] as const)("%s drafts", (type) => {
    function conversation() {
      const client = createClient(createRelay(), 1);
      return type === "direct" ? client.conversation("peer") : client.group("group");
    }

    it("clears the saved draft and notifies subscribers after preparation", async () => {
      const chat = conversation();
      const draft = { content: "prepared message", replyTo: "parent" };
      await chat.setDraft(draft);
      const send = vi.spyOn(chat, "send").mockResolvedValue(undefined);

      await chat.sendDraft();

      expect(send).toHaveBeenCalledWith({ ...draft, attachments: [] });
      expect(await firstValueFrom(chat.draft$)).toBeUndefined();
      expect(await chat.client.draftStorage().getItem(`draft:${chat.id}`)).toBeNull();
    });

    it("preserves the draft when preparation fails", async () => {
      const chat = conversation();
      await chat.setDraft({ content: "retry me" });
      vi.spyOn(chat, "send").mockRejectedValue(new Error("Preparation failed"));

      await expect(chat.sendDraft()).rejects.toThrow("Preparation failed");
      expect(await firstValueFrom(chat.draft$)).toMatchObject({ content: "retry me" });
    });

    it("preserves edits made during preparation", async () => {
      const chat = conversation();
      await chat.setDraft({ content: "submitted" });
      vi.spyOn(chat, "send").mockImplementation(async () => {
        await chat.setDraft({ content: "next message" });
        return undefined;
      });

      await chat.sendDraft();

      expect(await firstValueFrom(chat.draft$)).toMatchObject({ content: "next message" });
    });
  });

  it("registers a device and lists it with its label", async () => {
    const alice = createClient(createRelay(), 1);
    await register(alice);

    const devices = await firstValueFrom(alice.devices$.pipe(filter((list) => list.length > 0)));
    expect(devices).toEqual([expect.objectContaining({ current: true, label: "Test device" })]);
  });

  it("exchanges messages, reactions, and receipts between two owners", { timeout: 20000 }, async () => {
    const relay = createRelay();
    const alice = createClient(relay, 1);
    const bob = createClient(relay, 2);
    await Promise.all([register(alice), register(bob)]);

    const toBob = alice.conversation(bob.pubkey);
    const sent = await toBob.send({ content: "hello bob" });
    expect(sent?.delivery).toMatch(/queued|published/);

    const fromAlice = bob.conversation(alice.pubkey);
    const received = await waitForMessage(fromAlice.messages$, (m) => m.content === "hello bob");
    expect(received).toMatchObject({ sender: alice.pubkey, delivery: "received" });

    // Bob's automatic delivered receipt reaches Alice.
    await waitForMessage(toBob.messages$, (m) => m.id === sent!.id && m.delivery === "delivered");

    // Accepted envelopes leave the persistent outbox.
    await firstValueFrom(
      alice.pendingPublications$.pipe(
        filter((count) => count === 0),
        timeout(5000),
      ),
    );

    await fromAlice.react(received.id, "+");
    await fromAlice.markSeen();
    const reacted = await waitForMessage(toBob.messages$, (m) => m.delivery === "seen" && !!m.reactions["+"]);
    expect(reacted.reactions["+"]).toEqual([bob.pubkey]);

    const reply = await fromAlice.send({ content: "hi alice", replyTo: received.id });
    const replied = await waitForMessage(toBob.messages$, (m) => m.id === reply!.id);
    expect(replied.replyTo).toBe(received.id);
  });

  it("sends encrypted attachments as imeta and still applies receipts", { timeout: 20000 }, async () => {
    const relay = createRelay();
    const alice = createClient(relay, 1);
    const bob = createClient(relay, 2);
    await Promise.all([register(alice), register(bob)]);

    const toBob = alice.conversation(bob.pubkey);
    const file = await toBob.uploadFile(new Blob(["png bytes"], { type: "image/png" }));
    const sent = await toBob.send({ content: "look", attachments: [file] });
    expect(sent?.content).toBe(`look\n${file.url}`);

    const received = await waitForMessage(bob.conversation(alice.pubkey).messages$, (m) => m.id === sent!.id);
    expect(received.attachments).toEqual([
      expect.objectContaining({ url: file.url, type: "image/png", decryptionKey: file.decryptionKey }),
    ]);

    // Bob's delivered receipt (also kind 15) must not be mistaken for a file.
    await waitForMessage(toBob.messages$, (m) => m.id === sent!.id && m.delivery === "delivered");
    await expect(toBob.send({ content: " " })).rejects.toThrow("Message is empty");
  });

  it("stores an incoming NIP-17 kind 15 file message as a chat message", { timeout: 20000 }, async () => {
    const relay = createRelay();
    const alice = createClient(relay, 1);
    const bob = createClient(relay, 2);
    await Promise.all([register(alice), register(bob)]);

    const url = "https://files.example.com/photo";
    const tags = [
      ["file-type", "image/jpeg"],
      ["encryption-algorithm", "aes-gcm"],
      ["decryption-key", "11".repeat(32)],
      ["decryption-nonce", "22".repeat(12)],
    ];
    const rumor = await alice.runtime.sendMessage(bob.pubkey, url, { kind: 15, tags });

    const received = await waitForMessage(bob.conversation(alice.pubkey).messages$, (m) => m.id === rumor.id);
    expect(received.content).toBe("");
    expect(received.attachments).toEqual([expect.objectContaining({ url, type: "image/jpeg" })]);
  });

  it("creates a group, delivers the invitation, and exchanges group messages", { timeout: 20000 }, async () => {
    const relay = createRelay();
    const alice = createClient(relay, 1);
    const bob = createClient(relay, 2);
    await Promise.all([register(alice), register(bob)]);

    const aliceGroup = await alice.createGroup("Team", [bob.pubkey]);
    const invited = await firstValueFrom(
      bob.groups$.pipe(
        map((groups) => groups.find((record) => record.data.id === aliceGroup.groupId)),
        filter((record) => record !== undefined),
        timeout(5000),
      ),
    );
    expect(invited.data).toMatchObject({ name: "Team", accepted: false });

    const bobGroup = bob.group(aliceGroup.groupId);
    expect(await firstValueFrom(bobGroup.pending$)).toBe(true);
    expect(await firstValueFrom(bobGroup.canSend$)).toBe(false);
    expect(await firstValueFrom(bobGroup.admin$)).toBe(false);
    expect(await firstValueFrom(aliceGroup.admin$)).toBe(true);

    const summaries = await firstValueFrom(bob.conversations$);
    expect(summaries.find((summary) => summary.id === bobGroup.id)).toMatchObject({
      type: "group",
      groupId: aliceGroup.groupId,
    });

    await bobGroup.accept();
    expect(await firstValueFrom(bobGroup.pending$)).toBe(false);
    expect(await firstValueFrom(bobGroup.canSend$)).toBe(true);

    const sent = await aliceGroup.send({ content: "welcome" });
    expect(sent).toMatchObject({ content: "welcome", conversationId: aliceGroup.id, sender: alice.pubkey });
    await waitForMessage(bobGroup.messages$, (m) => m.content === "welcome" && m.sender === alice.pubkey);

    await bobGroup.send({ content: "thanks" });
    await waitForMessage(aliceGroup.messages$, (m) => m.content === "thanks" && m.sender === bob.pubkey);

    const file = await aliceGroup.uploadFile(new Blob(["group photo"], { type: "image/webp" }));
    await aliceGroup.send({ content: "", attachments: [file] });
    const attached = await waitForMessage(bobGroup.messages$, (m) => m.attachments?.[0]?.url === file.url);
    expect(attached.attachments?.[0]).toMatchObject({ type: "image/webp", decryptionKey: file.decryptionKey });

    await aliceGroup.rename("Core team");
    await firstValueFrom(
      bobGroup.group$.pipe(
        filter((record) => record?.data.name === "Core team"),
        timeout(5000),
      ),
    );
  });

  it("links a signer-less device approved by the owner's device", { timeout: 20000 }, async () => {
    const relay = createRelay();
    const phone = createClient(relay, 1);
    const laptop = createClient(relay, 1, false);
    await register(phone);
    await laptop.start();

    const url = await laptop.createLinkInvite();
    const identity = await phone.approveLink(url, "Laptop");

    await firstValueFrom(
      laptop.state$.pipe(
        filter((state) => state.isCurrentDeviceRegistered),
        timeout(5000),
      ),
    );
    const devices = await firstValueFrom(phone.devices$.pipe(filter((list) => list.length === 2)));
    expect(devices.find((device) => device.identityPubkey === identity)?.label).toBe("Laptop");
    await expect(laptop.prepareRegistration()).rejects.toThrow("signer");

    // A third owner's message reaches the linked device as well as the phone.
    const bob = createClient(relay, 2);
    await register(bob);
    await bob.conversation(phone.pubkey).send({ content: "to every device" });
    await waitForMessage(laptop.conversation(bob.pubkey).messages$, (m) => m.content === "to every device");
  });

  it("delivers to a device linked after the peer already opened a session", { timeout: 20000 }, async () => {
    const relay = createRelay();
    const phone = createClient(relay, 1);
    const bob = createClient(relay, 2);
    await Promise.all([register(phone), register(bob)]);

    // The phone opens the session, so Bob learns its roster from the invite response rather than a subscription.
    await phone.conversation(bob.pubkey).send({ content: "first" });
    await waitForMessage(bob.conversation(phone.pubkey).messages$, (m) => m.content === "first");

    const laptop = createClient(relay, 1, false);
    await laptop.start();
    await phone.approveLink(await laptop.createLinkInvite());
    await firstValueFrom(
      laptop.state$.pipe(
        filter((state) => state.isCurrentDeviceRegistered),
        timeout(5000),
      ),
    );

    // Bob's client follows the phone's roster, so the runtime learns about the laptop before sending.
    await vi.waitFor(() => expect(bob.runtime.getKnownDeviceIdentityPubkeysForOwner(phone.pubkey)).toHaveLength(2), {
      timeout: 5000,
    });
    await bob.conversation(phone.pubkey).send({ content: "late device" });
    await waitForMessage(laptop.conversation(bob.pubkey).messages$, (m) => m.content === "late device");
  });

  it("ignores invalid kind 37368 events from followed peers", { timeout: 20000 }, async () => {
    const relay = createRelay();
    const phone = createClient(relay, 1);
    const bob = createClient(relay, 2);
    await Promise.all([register(phone), register(bob)]);

    await phone.conversation(bob.pubkey).send({ content: "first" });
    await waitForMessage(bob.conversation(phone.pubkey).messages$, (m) => m.content === "first");

    const errors: unknown[] = [];
    const subscription = bob.errors$.subscribe((error) => errors.push(error));

    // Another application's event and a malformed roster share the AppKeys kind.
    const phoneKey = new Uint8Array(32).fill(1);
    const created_at = Math.floor(Date.now() / 1000) + 10;
    await relay.publish(
      relays,
      finalizeEvent({ kind: 37368, content: "", tags: [["d", "other-app"]], created_at }, phoneKey),
    );
    await relay.publish(
      relays,
      finalizeEvent(
        {
          kind: 37368,
          content: "not empty",
          tags: [
            ["d", "x"],
            ["type", "app_keys_roster_snapshot"],
          ],
          created_at,
        },
        phoneKey,
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));

    subscription.unsubscribe();
    expect(errors).toEqual([]);
    expect(bob.runtime.getKnownDeviceIdentityPubkeysForOwner(phone.pubkey)).toHaveLength(1);
  });

  it("revokes a device from the app keys", async () => {
    const relay = createRelay();
    const alice = createClient(relay, 1);
    await register(alice);

    const other = "f".repeat(64);
    await alice.runtime.registerDeviceIdentity({ ownerPubkey: alice.pubkey, identityPubkey: other });
    await firstValueFrom(alice.devices$.pipe(filter((list) => list.some((d) => d.identityPubkey === other))));

    await alice.revokeDevice(other);
    const devices = await firstValueFrom(
      alice.devices$.pipe(filter((list) => !list.some((d) => d.identityPubkey === other))),
    );
    expect(devices).toHaveLength(1);
  });

  it("reports a locked account instead of opening a second writer", async () => {
    vi.stubGlobal("navigator", {
      locks: { request: (_name: string, _options: unknown, work: (lock: null) => unknown) => work(null) },
    });
    const relay = createRelay();
    const client = new NdrMessagesClient({
      pubkey: getPublicKey(new Uint8Array(32).fill(3)),
      eventStore: new EventStore(),
      pool: relay as unknown as RelayPool,
      relays,
      storage: new InMemoryStorageAdapter(),
    });
    clients.push(client);

    await expect(client.start()).rejects.toThrow("another tab");
    expect(await firstValueFrom(client.lifecycle$)).toBe("locked");
  });

  it("stops writing to storage after disposal", async () => {
    const relay = createRelay();
    const storage = new InMemoryStorageAdapter();
    const client = new NdrMessagesClient({
      pubkey: getPublicKey(new Uint8Array(32).fill(4)),
      eventStore: new EventStore(),
      pool: relay as unknown as RelayPool,
      relays,
      storage,
      lockName: false,
    });
    await client.start();
    client.dispose();

    await expect(client.setDeviceLabel("a".repeat(64), "x")).rejects.toThrow();
    expect(await firstValueFrom(client.lifecycle$)).toBe("disposed");
  });
});
