import type { ConversationIndexEntry, ConversationIndexStore } from "./types.js";

/** The fields of a message that decide its place in the conversation index */
type IndexedMessage = { id: string; created_at: number };

/** Checks whether a message is newer than a conversation's indexed message, breaking timestamp ties by the lower id */
export function isNewerConversationMessage(
  message: IndexedMessage,
  entry: ConversationIndexEntry | undefined,
): boolean {
  if (!entry) return true;
  if (message.created_at !== entry.lastActivity) return message.created_at > entry.lastActivity;

  return message.id < entry.lastMessageId;
}

/**
 * Records a message as its conversation's newest activity when it is newer than the indexed message
 * @returns the new entry and whether the conversation was new to the index, or undefined when the index already has a newer message
 * @throws if the store cannot read or persist the entry
 */
export async function recordConversationMessage(
  store: ConversationIndexStore,
  id: string,
  message: IndexedMessage,
): Promise<{ entry: ConversationIndexEntry; inserted: boolean } | undefined> {
  const existing = await store.get(id);
  if (!isNewerConversationMessage(message, existing)) return undefined;

  const entry = { id, lastMessageId: message.id, lastActivity: message.created_at };
  await store.set(entry);

  return { entry, inserted: existing === undefined };
}

/** Orders entries like an IndexedDB "prev" cursor over [lastActivity, id], comparing ids by code unit rather than locale */
function compareConversationEntries(a: ConversationIndexEntry, b: ConversationIndexEntry): number {
  if (a.lastActivity !== b.lastActivity) return b.lastActivity - a.lastActivity;
  if (a.id === b.id) return 0;

  return a.id < b.id ? 1 : -1;
}

/** An in-memory conversation index store, used when the application does not supply one */
export class MemoryConversationIndexStore implements ConversationIndexStore {
  private readonly entries = new Map<string, ConversationIndexEntry>();

  /** Returns one conversation entry */
  get(id: string): ConversationIndexEntry | undefined {
    return this.entries.get(id);
  }

  /** Replaces one conversation entry */
  set(entry: ConversationIndexEntry): void {
    this.entries.set(entry.id, { ...entry });
  }

  /** Returns entries newest activity first, with the higher id first on timestamp ties */
  list(): ConversationIndexEntry[] {
    return [...this.entries.values()].sort(compareConversationEntries);
  }
}
