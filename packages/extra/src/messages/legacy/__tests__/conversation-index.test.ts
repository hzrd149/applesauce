import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, type Filter, type NostrEvent } from "applesauce-core/helpers";
import { createConversationIdentifier, getConversationParticipants } from "applesauce-common/helpers";
import { matchFilters } from "applesauce-core/helpers/filter";
import { PrivateKeySigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";
import { firstValueFrom } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LegacyMessagesClient,
  MemoryConversationIndexStore,
  type ConversationIndexEntry,
  type ConversationIndexStore,
  type LegacyConversationSummary,
  type LegacyMessagesClientOptions,
} from "../../index.js";

const ownerKey = new Uint8Array(32).fill(1);
const aliceKey = new Uint8Array(32).fill(2);
const owner = await new PrivateKeySigner(ownerKey).getPublicKey();
const alice = await new PrivateKeySigner(aliceKey).getPublicKey();
const bob = await new PrivateKeySigner(new Uint8Array(32).fill(3)).getPublicKey();

const withAlice = createConversationIdentifier(owner, [alice]);
const withBob = createConversationIdentifier(owner, [bob]);

const clients: LegacyMessagesClient[] = [];
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
});

/** Creates an encrypted-looking kind-4 message from one key to a recipient */
function message(key: Uint8Array, recipient: string, created_at: number): NostrEvent {
  return finalizeEvent(
    { kind: kinds.EncryptedDirectMessage, created_at, tags: [["p", recipient]], content: `encrypted ${created_at}` },
    key,
  );
}

function createClient(options: Partial<LegacyMessagesClientOptions> = {}) {
  const client = new LegacyMessagesClient({
    pubkey: owner,
    eventStore: new EventStore(),
    pool: {} as RelayPool,
    ...options,
  });
  clients.push(client);
  return client;
}

async function collect(conversations: AsyncIterable<LegacyConversationSummary>) {
  const summaries: LegacyConversationSummary[] = [];
  for await (const summary of conversations) summaries.push(summary);
  return summaries;
}

describe("legacy conversation index", () => {
  it("records the newest message of each correspondent as events reach the store", async () => {
    const eventStore = new EventStore();
    const conversationIndex = new MemoryConversationIndexStore();
    const client = createClient({ eventStore, conversationIndex });

    const newest = message(aliceKey, owner, 30);
    eventStore.add(newest);
    eventStore.add(message(ownerKey, alice, 10));
    eventStore.add(message(ownerKey, bob, 20));

    await vi.waitFor(() => expect(conversationIndex.list()).toHaveLength(2));
    const summaries = await collect(client.conversations());
    expect(summaries.map((summary) => summary.id)).toEqual([withAlice, withBob]);
    expect(summaries[0]).toEqual({
      id: withAlice,
      correspondent: alice,
      participants: getConversationParticipants(withAlice),
      lastMessage: newest,
      lastActivity: 30,
    });
  });

  it("indexes messages already in the event store when the client is created", async () => {
    const eventStore = new EventStore();
    eventStore.add(message(aliceKey, owner, 5));
    const conversationIndex = new MemoryConversationIndexStore();
    createClient({ eventStore, conversationIndex });

    await vi.waitFor(() => expect(conversationIndex.list()).toHaveLength(1));
  });

  it("restores conversations from a persisted index before messages load", async () => {
    const conversationIndex = new MemoryConversationIndexStore();
    conversationIndex.set({ id: withAlice, lastMessageId: "a".repeat(64), lastActivity: 50 });
    conversationIndex.set({ id: withBob, lastMessageId: "b".repeat(64), lastActivity: 20 });
    const client = createClient({ conversationIndex });

    expect(await collect(client.conversations())).toEqual([
      {
        id: withAlice,
        correspondent: alice,
        participants: getConversationParticipants(withAlice),
        lastMessage: undefined,
        lastActivity: 50,
      },
      {
        id: withBob,
        correspondent: bob,
        participants: getConversationParticipants(withBob),
        lastMessage: undefined,
        lastActivity: 20,
      },
    ]);
  });

  it("emits an insert for a new conversation and an update only when its newest message changes", async () => {
    const eventStore = new EventStore();
    const client = createClient({ eventStore });
    const inserts: LegacyConversationSummary[] = [];
    const updates: LegacyConversationSummary[] = [];
    const insertSubscription = client.conversationInserts$.subscribe((insert) => inserts.push(insert));
    const updateSubscription = client.conversationUpdates$.subscribe((update) => updates.push(update));

    const first = message(aliceKey, owner, 10);
    eventStore.add(first);
    eventStore.add(message(aliceKey, owner, 5));
    const newest = message(ownerKey, alice, 15);
    eventStore.add(newest);

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(inserts).toEqual([expect.objectContaining({ correspondent: alice, lastMessage: first })]);
    expect(updates[0]).toMatchObject({ correspondent: alice, lastMessage: newest });
    insertSubscription.unsubscribe();
    updateSubscription.unsubscribe();
  });

  it("reports index write failures and clears them after the next successful write", async () => {
    const failure = new Error("write failed");
    const entries = new Map<string, ConversationIndexEntry>();
    const set = vi
      .fn((entry: ConversationIndexEntry) => void entries.set(entry.id, entry))
      .mockImplementationOnce(() => {
        throw failure;
      });
    const conversationIndex: ConversationIndexStore = {
      get: (id) => entries.get(id),
      set,
      list: () => [...entries.values()],
    };
    const eventStore = new EventStore();
    const client = createClient({ eventStore, conversationIndex });

    eventStore.add(message(aliceKey, owner, 1));
    await vi.waitFor(async () => expect(await firstValueFrom(client.conversationIndexError$)).toBe(failure));

    eventStore.add(message(aliceKey, owner, 2));
    await vi.waitFor(() => expect(entries.size).toBe(1));
    expect(await firstValueFrom(client.conversationIndexError$)).toBeUndefined();
  });

  it("indexes cached messages across pages, including messages sharing a timestamp", async () => {
    // More correspondents than one page, all in one second, so a page boundary falls inside that second
    const cached = Array.from({ length: 600 }, (_, i) => {
      const key = new Uint8Array(32).fill(0);
      key[30] = (i >> 8) + 1;
      key[31] = i & 0xff;
      return message(key, owner, 100);
    });
    cached.push(message(aliceKey, owner, 50));

    // A minimal cache that applies since, until and limit like a real event cache
    const cacheRequest = vi.fn(async (filters: Filter[]) => {
      const matching = cached.filter((event) => matchFilters(filters, event));
      const limit = filters[0].limit;
      return limit === undefined ? matching : matching.slice(0, limit);
    });
    const conversationIndex = new MemoryConversationIndexStore();
    const client = createClient({ cacheRequest, conversationIndex });

    expect(await client.indexConversations()).toBe(601);
    expect(conversationIndex.list()).toHaveLength(601);
    expect(await client.indexConversations({ since: 60 })).toBe(600);
  });

  it("indexes nothing without an event cache", async () => {
    expect(await createClient().indexConversations()).toBe(0);
  });

  it("stops indexing when aborted", async () => {
    const client = createClient({ cacheRequest: async () => [message(aliceKey, owner, 1)] });
    const controller = new AbortController();
    controller.abort();

    await expect(client.indexConversations({ signal: controller.signal })).rejects.toThrow();
  });
});
