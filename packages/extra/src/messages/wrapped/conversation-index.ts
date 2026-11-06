import type {
  WrappedConversationIndexEntry,
  WrappedConversationIndexListOptions,
  WrappedConversationIndexStore,
} from "./types.js";

/** An in-memory conversation index store, used when the application does not supply one */
export class MemoryWrappedConversationIndexStore implements WrappedConversationIndexStore {
  private readonly entries = new Map<string, WrappedConversationIndexEntry>();

  /** Returns one conversation entry */
  get(id: string): WrappedConversationIndexEntry | undefined {
    return this.entries.get(id);
  }

  /** Replaces one conversation entry */
  set(entry: WrappedConversationIndexEntry): void {
    this.entries.set(entry.id, { ...entry });
  }

  /** Returns entries newest activity first, with ids breaking ties so pages are stable */
  list(options: WrappedConversationIndexListOptions = {}): WrappedConversationIndexEntry[] {
    const { until } = options;
    const entries = [...this.entries.values()].filter((entry) => until === undefined || entry.lastActivity <= until);

    return entries.sort((a, b) => b.lastActivity - a.lastActivity || a.id.localeCompare(b.id));
  }
}
