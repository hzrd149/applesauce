import { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import { firstValueFrom } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyMessagesClient, WrappedMessagesClient, type MessageStorage } from "../index.js";
import { ConversationDraftState } from "../common/drafts.js";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const clients: { dispose(): void }[] = [];
afterEach(() => clients.splice(0).forEach((client) => client.dispose()));

function createStorage(asynchronous = false) {
  const values = new Map<string, string>();
  const storage: MessageStorage = {
    getItem: vi.fn((key: string) =>
      asynchronous ? Promise.resolve(values.get(key) ?? null) : (values.get(key) ?? null),
    ),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
      return asynchronous ? Promise.resolve(value) : undefined;
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
      return asynchronous ? Promise.resolve() : undefined;
    }),
  };
  return { storage, values };
}

function createConversation(protocol: "legacy" | "wrapped", storage?: MessageStorage, owner = alice, peer = bob) {
  const options = { pubkey: owner, eventStore: new EventStore(), pool: {} as RelayPool, draftStorage: storage };
  const client = protocol === "legacy" ? new LegacyMessagesClient(options) : new WrappedMessagesClient(options);
  clients.push(client);
  return client instanceof LegacyMessagesClient ? client.conversation(peer) : client.conversation([peer]);
}

describe.each(["legacy", "wrapped"] as const)("%s conversation drafts", (protocol) => {
  it.each([false, true])("restores, updates, and removes drafts with async storage: %s", async (asynchronous) => {
    const { storage, values } = createStorage(asynchronous);
    const conversation = createConversation(protocol, storage);
    const draft = { content: "unsent", replyTo: "parent", expiration: 1234567890 };
    expect(await firstValueFrom(conversation.draft$)).toBeUndefined();
    await conversation.setDraft(draft);
    expect(await firstValueFrom(conversation.draft$)).toEqual(draft);
    expect(values.size).toBe(1);
    conversation.dispose();

    const restored = createConversation(protocol, storage);
    expect(await firstValueFrom(restored.draft$)).toEqual(draft);
    expect(await restored.loadDraft()).toEqual(draft);
    await restored.clearDraft();
    expect(values.size).toBe(0);
    expect(await firstValueFrom(restored.draft$)).toBeUndefined();
    expect(await createConversation(protocol, storage).loadDraft()).toBeUndefined();
  });

  it("keeps an editable draft in memory without storage", async () => {
    const conversation = createConversation(protocol);
    await conversation.setDraft({ content: "" });
    expect(await firstValueFrom(conversation.draft$)).toEqual({ content: "" });
    await conversation.clearDraft();
    expect(await conversation.loadDraft()).toBeUndefined();
  });

  it("uses conversation-only keys and leaves account separation to the adapter", async () => {
    const { storage, values } = createStorage();
    const conversation = createConversation(protocol, storage);
    await conversation.setDraft({ content: "draft" });
    expect([...values.keys()]).toEqual([`draft:${conversation.id}`]);
    expect(await createConversation(protocol, storage, alice, alice).loadDraft()).toBeUndefined();
    const otherAccountStorage = createStorage().storage;
    expect(await createConversation(protocol, otherAccountStorage, bob, alice).loadDraft()).toBeUndefined();
  });

  it("preserves storage on disposal and rejects further edits", async () => {
    const { storage, values } = createStorage();
    const conversation = createConversation(protocol, storage);
    await conversation.setDraft({ content: "keep" });
    const complete = vi.fn();
    const subscription = conversation.draft$.subscribe({ complete });
    conversation.dispose();
    expect(complete).toHaveBeenCalledOnce();
    expect(subscription.closed).toBe(true);
    await expect(conversation.setDraft({ content: "closed" })).rejects.toThrow("disposed");
    await expect(conversation.clearDraft()).rejects.toThrow("disposed");
    await expect(conversation.loadDraft()).rejects.toThrow("disposed");
    expect(values.size).toBe(1);
  });
});

it("allows applications to separate protocols with different adapters", async () => {
  const legacy = createStorage();
  const wrapped = createStorage();
  await createConversation("legacy", legacy.storage).setDraft({ content: "legacy" });
  expect(await createConversation("wrapped", wrapped.storage).loadDraft()).toBeUndefined();
});

it("serializes asynchronous writes and clearing in invocation order", async () => {
  const { storage, values } = createStorage();
  let finishWrite!: () => void;
  vi.mocked(storage.setItem).mockImplementationOnce(
    (key, value) =>
      new Promise<void>((resolve) => {
        finishWrite = () => {
          values.set(key, value);
          resolve();
        };
      }),
  );
  const drafts = new ConversationDraftState("draft", storage);
  const draft = { content: "first" };
  const first = drafts.set(draft);
  draft.content = "mutated";
  const second = drafts.set({ content: "second" });
  const clear = drafts.clear();
  await vi.waitFor(() => expect(storage.setItem).toHaveBeenCalledOnce());
  expect(JSON.parse(vi.mocked(storage.setItem).mock.calls[0][1]).draft.content).toBe("first");
  expect(storage.removeItem).not.toHaveBeenCalled();
  finishWrite();
  await Promise.all([first, second, clear]);
  expect(values.size).toBe(0);
  expect(await drafts.load()).toBeUndefined();
  drafts.dispose();
});

it("does not let slow restoration overwrite a later edit", async () => {
  const { storage } = createStorage();
  let finishRead!: (value: string) => void;
  vi.mocked(storage.getItem).mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finishRead = resolve;
      }),
  );
  const drafts = new ConversationDraftState("draft", storage);
  const restoring = drafts.load();
  const editing = drafts.set({ content: "new" });
  await vi.waitFor(() => expect(storage.getItem).toHaveBeenCalledOnce());
  finishRead(JSON.stringify({ version: 1, draft: { content: "old" } }));
  await Promise.all([restoring, editing]);
  expect(await drafts.load()).toEqual({ content: "new" });
  drafts.dispose();
});

it("propagates storage failures without changing the current draft and allows retry", async () => {
  const { storage } = createStorage();
  const drafts = new ConversationDraftState("draft", storage);
  await drafts.set({ content: "saved" });
  vi.mocked(storage.setItem).mockRejectedValueOnce(new Error("write failed"));
  await expect(drafts.set({ content: "lost" })).rejects.toThrow("write failed");
  expect(await drafts.load()).toEqual({ content: "saved" });
  vi.mocked(storage.removeItem).mockRejectedValueOnce(new Error("remove failed"));
  await expect(drafts.clear()).rejects.toThrow("remove failed");
  expect(await drafts.load()).toEqual({ content: "saved" });
  await drafts.clear();
  expect(await drafts.load()).toBeUndefined();
  drafts.dispose();
});

it.each(["invalid json", '{"version":2,"draft":{"content":"future"}}', '{"version":1,"draft":{"content":4}}'])(
  "rejects invalid persisted drafts without removing them: %s",
  async (serialized) => {
    const { storage, values } = createStorage();
    values.set("draft", serialized);
    const drafts = new ConversationDraftState("draft", storage);
    await expect(drafts.load()).rejects.toThrow();
    expect(values.get("draft")).toBe(serialized);
    await drafts.set({ content: "recovered" });
    expect(await drafts.load()).toEqual({ content: "recovered" });
    drafts.dispose();
  },
);

it("shares restored state across subscriptions and retries failed reads", async () => {
  const { storage } = createStorage(true);
  vi.mocked(storage.getItem).mockRejectedValueOnce(new Error("read failed"));
  const drafts = new ConversationDraftState("draft", storage);
  await expect(firstValueFrom(drafts.draft$)).rejects.toThrow("read failed");
  await Promise.all([firstValueFrom(drafts.draft$), firstValueFrom(drafts.draft$)]);
  expect(storage.getItem).toHaveBeenCalledTimes(2);
  drafts.dispose();
});
