import { InMemoryStorageAdapter } from "nostr-double-ratchet";
import { describe, expect, it } from "vitest";
import { getNdrGroupConversationId, NdrHistory, type StoredNdrMessage } from "../history.js";

const alice = "a".repeat(64);
const bob = "b".repeat(64);

function message(overrides: Partial<StoredNdrMessage> = {}): StoredNdrMessage {
  return {
    id: "m1",
    conversationId: bob,
    content: "hello",
    sender: alice,
    createdAt: 100,
    delivery: "queued",
    ...overrides,
  };
}

describe("NdrHistory", () => {
  it("restores stored messages and ignores replayed rumors", async () => {
    const storage = new InMemoryStorageAdapter();
    const history = new NdrHistory(storage, () => 1000);

    expect(await history.addMessage(message())).toBe(true);
    expect(await history.addMessage(message({ content: "replayed" }))).toBe(false);

    const restored = new NdrHistory(storage, () => 1000);
    await restored.restore();
    expect(restored.messages(bob).map((m) => m.content)).toEqual(["hello"]);
  });

  it("restores message attachments", async () => {
    const storage = new InMemoryStorageAdapter();
    const attachments = [{ url: "https://files.example.com/a", type: "image/png", decryptionKey: "11".repeat(32) }];
    await new NdrHistory(storage, () => 1000).addMessage(message({ attachments }));

    const restored = new NdrHistory(storage, () => 1000);
    await restored.restore();
    expect(restored.messages(bob)[0].attachments).toEqual(attachments);
  });

  it("applies reactions that arrive before their message", async () => {
    const history = new NdrHistory(new InMemoryStorageAdapter(), () => 1000);

    await history.addReaction(bob, { id: "r1", target: "m1", content: "+", sender: bob });
    await history.addReaction(bob, { id: "r1", target: "m1", content: "+", sender: bob });
    await history.addReaction(bob, { id: "r2", target: "m1", content: "+", sender: alice });
    await history.addMessage(message());

    expect(history.messages(bob)[0].reactions).toEqual({ "+": [bob, alice] });
  });

  it("advances sent messages through relay and peer receipts without regressing", async () => {
    const history = new NdrHistory(new InMemoryStorageAdapter(), () => 1000);
    await history.addMessage(message());

    await history.advanceDelivery("m1", "published");
    expect(history.messages(bob)[0].delivery).toBe("published");

    await history.addReceipt(bob, ["m1"], "seen");
    await history.addReceipt(bob, ["m1"], "delivered");
    expect(history.messages(bob)[0].delivery).toBe("seen");

    await history.advanceDelivery("m1", "published");
    expect(history.messages(bob)[0].delivery).toBe("seen");
  });

  it("never applies receipts to incoming messages", async () => {
    const history = new NdrHistory(new InMemoryStorageAdapter(), () => 1000);
    await history.addMessage(message({ sender: bob, delivery: "received" }));
    await history.addReceipt(bob, ["m1"], "seen");

    expect(history.messages(bob)[0].delivery).toBe("received");
  });

  it("counts unread incoming messages until they are marked read", async () => {
    const history = new NdrHistory(new InMemoryStorageAdapter(), () => 1000);
    await history.addMessage(message({ id: "m1", sender: bob, delivery: "received", createdAt: 100 }));
    await history.addMessage(message({ id: "m2", sender: bob, delivery: "received", createdAt: 200 }));
    await history.addMessage(message({ id: "m3", createdAt: 300 }));

    expect(history.conversations()[0]).toMatchObject({ id: bob, type: "direct", unread: 2 });

    await history.markRead(bob, 100);
    expect(history.conversations()[0].unread).toBe(1);
    expect(history.conversations()[0].lastMessage?.id).toBe("m3");
  });

  it("purges expired messages on restore and hides them before then", async () => {
    const storage = new InMemoryStorageAdapter();
    let now = 1000;
    const history = new NdrHistory(storage, () => now);
    await history.addMessage(message({ expiresAt: 1500 }));
    expect(history.messages(bob)).toHaveLength(1);

    now = 2000;
    expect(history.messages(bob)).toHaveLength(0);

    const restored = new NdrHistory(storage, () => now);
    await restored.restore();
    expect(await storage.list("app/messages/")).toEqual([]);
  });

  it("lists groups as conversations and removes their history with them", async () => {
    const history = new NdrHistory(new InMemoryStorageAdapter(), () => 1000);
    const data = { id: "g1", name: "Team", members: [alice, bob], admins: [alice], createdAt: 50_000 };
    const conversationId = getNdrGroupConversationId("g1");

    await history.putGroup({ data, revision: 1, createdBy: alice });
    await history.addMessage(message({ conversationId }));
    expect(history.conversations().map((c) => c.type)).toEqual(["group"]);

    await history.removeGroup("g1");
    expect(history.conversations()).toEqual([]);
  });
});
