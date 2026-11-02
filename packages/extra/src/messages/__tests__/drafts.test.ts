import { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import { firstValueFrom } from "rxjs";
import localforage from "localforage";
import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { LegacyMessagesClient, WrappedMessagesClient, type MessageFileStorage, type MessageStorage } from "../index.js";
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

it("conditionally clears immutable revisions rather than matching draft fields", async () => {
  const { storage } = createStorage(true);
  const drafts = new ConversationDraftState("draft", storage);
  const signal = new AbortController().signal;
  await drafts.set({ content: "first" });
  const captured = (await drafts.load())!;
  await drafts.set({ content: "other" });
  await drafts.set({ content: "first" });
  await drafts.clearIfCurrent(captured, signal);
  expect(storage.removeItem).not.toHaveBeenCalled();
  const current = (await drafts.load())!;
  expect(current).not.toBe(captured);
  await drafts.clearIfCurrent(current, signal);
  expect(storage.removeItem).toHaveBeenCalledOnce();
  expect(await drafts.load()).toBeUndefined();
  drafts.dispose();
});

it("checks conditional removal cancellation inside the serialized storage queue", async () => {
  const { storage } = createStorage();
  const drafts = new ConversationDraftState("draft", storage);
  await drafts.set({ content: "saved" });
  const captured = (await drafts.load())!;
  const controller = new AbortController();
  const clearing = drafts.clearIfCurrent(captured, controller.signal);
  controller.abort();
  await expect(clearing).rejects.toThrow();
  expect(storage.removeItem).not.toHaveBeenCalled();
  expect(await drafts.load()).toBe(captured);
  drafts.dispose();
});

function createFileStorage() {
  const blobs = new Map<string, Blob>();
  const fileStorage: MessageFileStorage = {
    getItem: vi.fn(async (key: string) => blobs.get(key) ?? null),
    setItem: vi.fn(async (key: string, blob: Blob) => void blobs.set(key, blob)),
    removeItem: vi.fn(async (key: string) => void blobs.delete(key)),
  };
  return { fileStorage, blobs };
}

const image = () => new File(["png bytes"], "image.png", { type: "image/png", lastModified: 1000 });

describe("draft files", () => {
  it("restores staged files after a reload", async () => {
    const { storage } = createStorage(true);
    const { fileStorage, blobs } = createFileStorage();
    const drafts = new ConversationDraftState("draft", storage, fileStorage);
    await drafts.set({ content: "look", files: [image()] });
    drafts.dispose();

    const restored = await new ConversationDraftState("draft", storage, fileStorage).load();
    expect(blobs.size).toBe(1);
    expect(restored?.content).toBe("look");
    expect(restored?.files).toHaveLength(1);

    const file = restored!.files![0];
    expect([file.name, file.type, file.lastModified]).toEqual(["image.png", "image/png", 1000]);
    expect(await file.text()).toBe("png bytes");
  });

  it("does not rewrite a file that is already saved", async () => {
    const { storage } = createStorage();
    const { fileStorage } = createFileStorage();
    const drafts = new ConversationDraftState("draft", storage, fileStorage);
    const file = image();
    await drafts.set({ content: "", files: [file] });
    await drafts.set({ content: "edited", files: [file] });
    expect(fileStorage.setItem).toHaveBeenCalledOnce();

    // Files restored from storage are recognized too
    const restored = new ConversationDraftState("draft", storage, fileStorage);
    const draft = (await restored.load())!;
    await restored.set({ ...draft, content: "again" });
    expect(fileStorage.setItem).toHaveBeenCalledOnce();
  });

  it("removes the bytes of files taken out of the draft", async () => {
    const { storage } = createStorage();
    const { fileStorage, blobs } = createFileStorage();
    const drafts = new ConversationDraftState("draft", storage, fileStorage);
    const kept = image();
    await drafts.set({ content: "", files: [kept, image()] });
    expect(blobs.size).toBe(2);

    await drafts.set({ content: "", files: [kept] });
    expect(blobs.size).toBe(1);
  });

  it.each(["clear", "clearIfCurrent"] as const)("removes saved files with %s", async (method) => {
    const { storage, values } = createStorage();
    const { fileStorage, blobs } = createFileStorage();
    const drafts = new ConversationDraftState("draft", storage, fileStorage);
    await drafts.set({ content: "", files: [image()] });

    if (method === "clear") await drafts.clear();
    else await drafts.clearIfCurrent((await drafts.load())!, new AbortController().signal);
    expect(values.size).toBe(0);
    expect(blobs.size).toBe(0);
  });

  it("removes files saved in an earlier session when the draft is replaced before loading", async () => {
    const { storage } = createStorage();
    const { fileStorage, blobs } = createFileStorage();
    await new ConversationDraftState("draft", storage, fileStorage).set({ content: "", files: [image()] });

    await new ConversationDraftState("draft", storage, fileStorage).set({ content: "text only" });
    expect(blobs.size).toBe(0);
  });

  it("skips a file whose bytes are missing", async () => {
    const { storage } = createStorage();
    const { fileStorage, blobs } = createFileStorage();
    await new ConversationDraftState("draft", storage, fileStorage).set({ content: "hi", files: [image()] });
    blobs.clear();

    const restored = await new ConversationDraftState("draft", storage, fileStorage).load();
    expect(restored).toEqual({ content: "hi" });
  });

  it("loads a draft saved before files were supported", async () => {
    const { storage, values } = createStorage();
    const { fileStorage } = createFileStorage();
    values.set("draft", JSON.stringify({ version: 1, draft: { content: "old" } }));
    expect(await new ConversationDraftState("draft", storage, fileStorage).load()).toEqual({ content: "old" });
  });

  it("keeps files in memory only without file storage", async () => {
    const { storage, values } = createStorage();
    const drafts = new ConversationDraftState("draft", storage);
    const file = image();
    await drafts.set({ content: "", files: [file] });
    expect((await drafts.load())?.files).toEqual([file]);
    expect(JSON.parse(values.get("draft")!).files).toEqual([]);
    drafts.dispose();

    expect((await new ConversationDraftState("draft", storage).load())?.files).toBeUndefined();
  });

  it("rejects files that are not File objects", async () => {
    const drafts = new ConversationDraftState("draft");
    await expect(drafts.set({ content: "", files: ["image.png" as unknown as File] })).rejects.toThrow(
      "Invalid conversation draft",
    );
  });
});

describe("localForage compatibility", () => {
  it("accepts a localForage instance as draft and draft file storage", () => {
    expectTypeOf<LocalForage>().toMatchTypeOf<MessageStorage>();
    expectTypeOf<LocalForage>().toMatchTypeOf<MessageFileStorage>();
  });

  it("restores staged files from a localForage instance", async () => {
    const values = new Map<string, unknown>();
    const driver = "memory-draft-test";
    await localforage.defineDriver({
      _driver: driver,
      _support: true,
      _initStorage: async () => {},
      getItem: async (key: string) => (values.get(key) ?? null) as never,
      setItem: async (key: string, value: unknown) => {
        values.set(key, value);
        return value as never;
      },
      removeItem: async (key: string) => void values.delete(key),
      clear: async () => values.clear(),
      length: async () => values.size,
      key: async (index: number) => [...values.keys()][index],
      keys: async () => [...values.keys()],
      iterate: async () => undefined as never,
    });

    const store = localforage.createInstance({ name: "drafts", driver });
    await new ConversationDraftState("draft", store, store).set({ content: "look", files: [image()] });

    const restored = await new ConversationDraftState("draft", store, store).load();
    expect(await restored?.files?.[0].text()).toBe("png bytes");
  });
});
