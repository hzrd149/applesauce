import { createConversationIdentifier } from "applesauce-common/helpers";
import { EventStore } from "applesauce-core";
import { RumorStore } from "applesauce-core/event-store";
import { getEventHash, kinds, type Rumor } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryConversationIndexStore,
  WrappedMessagesClient,
  type MessageClientError,
  type ConversationIndexEntry,
  type ConversationIndexStore,
  type WrappedConversationSummary,
} from "../index.js";

const owner = await new PrivateKeySigner(new Uint8Array(32).fill(1)).getPublicKey();
const alice = await new PrivateKeySigner(new Uint8Array(32).fill(2)).getPublicKey();
const bob = await new PrivateKeySigner(new Uint8Array(32).fill(3)).getPublicKey();

const withAlice = createConversationIdentifier(owner, alice);
const withAliceAndBob = createConversationIdentifier(owner, alice, bob);

const clients: WrappedMessagesClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
});

function message(author: string, recipients: string[], created_at: number, kind: number = kinds.PrivateDirectMessage) {
  const template = {
    kind,
    pubkey: author,
    created_at,
    tags: recipients.map((pubkey) => ["p", pubkey]),
    content: `message ${created_at}`,
  };
  return { ...template, id: getEventHash(template) } satisfies Rumor;
}

function createClient(rumorStore = new RumorStore(), conversationIndex?: ConversationIndexStore) {
  const client = new WrappedMessagesClient({
    pubkey: owner,
    eventStore: new EventStore(),
    pool: {} as RelayPool,
    rumorStore,
    conversationIndex,
  });
  clients.push(client);
  return client;
}

async function collect(conversations: AsyncIterable<WrappedConversationSummary>) {
  const summaries: WrappedConversationSummary[] = [];
  for await (const summary of conversations) summaries.push(summary);
  return summaries;
}

describe("wrapped conversation index", () => {
  it("records the newest message of each participant set as rumors arrive", async () => {
    const rumorStore = new RumorStore();
    const index = new MemoryConversationIndexStore();
    const client = createClient(rumorStore, index);

    const newest = message(alice, [owner], 30);
    rumorStore.add(newest);
    rumorStore.add(message(owner, [alice], 10));
    rumorStore.add(message(bob, [owner, alice], 20));
    rumorStore.add(message(alice, [owner], 40, kinds.ShortTextNote));

    await vi.waitFor(() => expect(index.list()).toHaveLength(2));
    const summaries = await collect(client.conversations());
    expect(summaries.map((summary) => summary.id)).toEqual([withAlice, withAliceAndBob]);
    expect(summaries[0]).toEqual({
      id: withAlice,
      participants: [owner, alice].sort(),
      lastMessage: newest,
      lastActivity: 30,
    });
  });

  it("lists newest first and leaves lastMessage undefined when the rumor is not stored", async () => {
    const index = new MemoryConversationIndexStore();
    index.set({ id: withAlice, lastMessageId: "a".repeat(64), lastActivity: 50 });
    index.set({ id: withAliceAndBob, lastMessageId: "b".repeat(64), lastActivity: 20 });
    const client = createClient(new RumorStore(), index);

    expect(await collect(client.conversations())).toEqual([
      { id: withAlice, participants: [owner, alice].sort(), lastMessage: undefined, lastActivity: 50 },
      { id: withAliceAndBob, participants: [owner, alice, bob].sort(), lastMessage: undefined, lastActivity: 20 },
    ]);
  });

  it("emits an insert for a new conversation and an update only when its newest message changes", async () => {
    const rumorStore = new RumorStore();
    const client = createClient(rumorStore);
    const inserts: WrappedConversationSummary[] = [];
    const updates: WrappedConversationSummary[] = [];
    const insertSubscription = client.conversationInserts$.subscribe((insert) => inserts.push(insert));
    const updateSubscription = client.conversationUpdates$.subscribe((update) => updates.push(update));

    const first = message(alice, [owner], 10);
    rumorStore.add(first);
    rumorStore.add(message(alice, [owner], 5));
    const newest = message(owner, [alice], 15);
    rumorStore.add(newest);

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(inserts.map((insert) => insert.lastMessage)).toEqual([first]);
    expect(updates[0].lastMessage).toEqual(newest);
    insertSubscription.unsubscribe();
    updateSubscription.unsubscribe();
  });

  it("indexes stored rumors across pages, including rumors sharing a timestamp", async () => {
    const rumorStore = new RumorStore();
    // More conversations than one page, all in one second, so a page boundary falls inside that second
    const peers = Array.from({ length: 600 }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
    for (const peer of peers) rumorStore.add(message(peer, [owner], 100));
    rumorStore.add(message(alice, [owner], 50));
    const index = new MemoryConversationIndexStore();
    const client = createClient(rumorStore, index);

    expect(await client.indexConversations()).toBe(601);
    expect(index.list()).toHaveLength(601);
    expect(await client.indexConversations({ since: 60 })).toBe(600);
  });

  it("stops indexing when aborted", async () => {
    const rumorStore = new RumorStore();
    rumorStore.add(message(alice, [owner], 1));
    const client = createClient(rumorStore);
    const controller = new AbortController();
    controller.abort();

    await expect(client.indexConversations({ signal: controller.signal })).rejects.toThrow();
  });

  it("reports index write failures and records the next message", async () => {
    const failure = new Error("write failed");
    const entries = new Map<string, ConversationIndexEntry>();
    const set = vi
      .fn((entry: ConversationIndexEntry) => void entries.set(entry.id, entry))
      .mockImplementationOnce(() => {
        throw failure;
      });
    // An async iterable store exercises the paged listing path
    const store: ConversationIndexStore = {
      get: async (id) => entries.get(id),
      set,
      async *list() {
        yield* [...entries.values()].sort((a, b) => b.lastActivity - a.lastActivity);
      },
    };
    const rumorStore = new RumorStore();
    const client = createClient(rumorStore, store);
    const errors: MessageClientError[] = [];
    const subscription = client.errors$.subscribe((error) => errors.push(error));

    const first = message(alice, [owner], 1);
    rumorStore.add(first);
    await vi.waitFor(() => expect(errors).toEqual([{ operation: "storage", error: failure, eventId: first.id }]));

    rumorStore.add(message(alice, [owner], 2));
    await vi.waitFor(() => expect(entries.size).toBe(1));
    expect((await collect(client.conversations()))[0].lastActivity).toBe(2);
    subscription.unsubscribe();
  });
});
