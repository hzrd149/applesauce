import type { ConversationIndexEntry } from "../common/types.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IndexedDBConversationIndexStore } from "../common/indexed-db-conversation-index.js";

function entry(index: number, lastActivity: number): ConversationIndexEntry {
  return { id: index.toString(16).padStart(64, "0"), lastMessageId: "f".repeat(64), lastActivity };
}

async function collect(entries: AsyncIterable<ConversationIndexEntry>, between?: () => Promise<unknown>) {
  const listed: ConversationIndexEntry[] = [];
  for await (const item of entries) {
    listed.push(item);
    await between?.();
  }
  return listed;
}

let name: string;
let database: IndexedDBConversationIndexStore;

beforeEach(async () => {
  name = `conversation-index-test-${crypto.randomUUID()}`;
  database = await IndexedDBConversationIndexStore.open(name);
});

afterEach(() => {
  database.close();
  indexedDB.deleteDatabase(name);
});

describe("IndexedDBConversationIndexStore", () => {
  it("replaces entries by conversation id", async () => {
    await database.set(entry(1, 10));
    await database.set(entry(1, 20));

    expect(await database.get(entry(1, 0).id)).toEqual(entry(1, 20));
    expect(await collect(database.list())).toEqual([entry(1, 20)]);
  });

  it("lists every entry newest first across batches while the caller awaits other work", async () => {
    // Timestamps repeat so batch boundaries fall between entries that share a timestamp
    const entries = Array.from({ length: 120 }, (_, index) => entry(index + 1, 1000 - Math.floor(index / 7)));
    for (const item of entries) await database.set(item);

    const listed = await collect(database.list(), () => new Promise((resolve) => setTimeout(resolve)));
    expect(listed).toHaveLength(120);
    expect(new Set(listed.map((item) => item.id)).size).toBe(120);
    expect(listed.map((item) => item.lastActivity)).toEqual(entries.map((item) => item.lastActivity));
  });

  it("includes every entry at the until timestamp", async () => {
    await database.set(entry(1, 30));
    await database.set(entry(2, 20));
    await database.set(entry(3, 20));
    await database.set(entry(4, 10));

    const listed = await collect(database.list({ until: 20 }));
    expect(listed.map((item) => item.lastActivity)).toEqual([20, 20, 10]);
  });
});
