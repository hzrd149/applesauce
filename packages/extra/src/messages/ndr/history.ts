import { unixNow } from "applesauce-core/helpers";
import type { StorageAdapter } from "nostr-double-ratchet";
import { BehaviorSubject } from "rxjs";
import type { NdrConversationSummary, NdrDeliveryState, NdrGroupRecord, NdrMessage } from "./types.js";

/** The storage prefix for application records, kept apart from the runtime's `v1/` protocol state */
const PREFIX = "app/";
const MESSAGES = `${PREFIX}messages/`;
const REACTIONS = `${PREFIX}reactions/`;
const RECEIPTS = `${PREFIX}receipts/`;
const READ = `${PREFIX}read/`;
const GROUPS = `${PREFIX}groups/`;
const TTLS = `${PREFIX}ttl/`;
const LABELS = `${PREFIX}labels/`;
const GROUP_PREFIX = "group:";

const DELIVERY_RANK: Record<NdrDeliveryState, number> = {
  received: 0,
  queued: 1,
  published: 2,
  delivered: 3,
  seen: 4,
};

/** A message as stored, before reactions and receipts are applied */
export type StoredNdrMessage = Omit<NdrMessage, "reactions">;

/** A stored reaction to a message */
export interface StoredNdrReaction {
  /** The reaction rumor ID */
  id: string;
  /** The reacted message ID */
  target: string;
  /** The reaction content, usually an emoji */
  content: string;
  /** The reacting owner pubkey */
  sender: string;
}

/** Returns the conversation ID for a group */
export function getNdrGroupConversationId(groupId: string): string {
  return `${GROUP_PREFIX}${groupId}`;
}

/** Returns the group ID of a group conversation ID, or undefined for a direct conversation */
export function getNdrGroupId(conversationId: string): string | undefined {
  return conversationId.startsWith(GROUP_PREFIX) ? conversationId.slice(GROUP_PREFIX.length) : undefined;
}

/** Returns the later of two delivery states */
function laterDelivery(a: NdrDeliveryState, b: NdrDeliveryState): NdrDeliveryState {
  return DELIVERY_RANK[b] > DELIVERY_RANK[a] ? b : a;
}

/** Keeps an in-memory mirror of decrypted NDR history and persists every change to a StorageAdapter */
export class NdrHistory {
  private readonly records = new Map<string, unknown>();
  private readonly revision = new BehaviorSubject(0);

  /** Emits after every restore or change */
  readonly changes$ = this.revision.asObservable();

  constructor(
    private readonly storage: StorageAdapter,
    private readonly now: () => number = unixNow,
  ) {}

  private changed() {
    this.revision.next(this.revision.value + 1);
  }

  private async write(key: string, value: unknown) {
    await this.storage.put(key, value);
    this.records.set(key, value);
  }

  private async remove(key: string) {
    await this.storage.del(key);
    this.records.delete(key);
  }

  private entries<T>(prefix: string): [string, T][] {
    const entries: [string, T][] = [];
    for (const [key, value] of this.records) {
      if (key.startsWith(prefix)) entries.push([key, value as T]);
    }
    return entries;
  }

  private findMessage(id: string): StoredNdrMessage | undefined {
    for (const [key, message] of this.entries<StoredNdrMessage>(MESSAGES)) {
      if (key.endsWith(`/${id}`)) return message;
    }
    return undefined;
  }

  /**
   * Loads every application record from storage and removes expired messages
   * @throws if storage fails
   */
  async restore(): Promise<void> {
    const keys = await this.storage.list(PREFIX);
    const values = await Promise.all(keys.map((key) => this.storage.get(key)));

    this.records.clear();
    keys.forEach((key, index) => {
      if (values[index] !== undefined) this.records.set(key, values[index]);
    });

    await this.purgeExpired();
    this.changed();
  }

  /**
   * Stores a message once, returning false when the message was already stored
   * @throws if storage fails
   */
  async addMessage(message: StoredNdrMessage): Promise<boolean> {
    const key = `${MESSAGES}${message.conversationId}/${message.id}`;
    // Durable replay may deliver the same rumor again after a reload.
    if (this.records.has(key)) return false;

    await this.write(key, message);
    this.changed();
    return true;
  }

  /**
   * Advances a message's delivery state, ignoring unknown messages and older states
   * @throws if storage fails
   */
  async advanceDelivery(id: string, delivery: NdrDeliveryState): Promise<void> {
    const message = this.findMessage(id);
    if (!message || message.delivery === "received") return;

    const next = laterDelivery(message.delivery, delivery);
    if (next === message.delivery) return;

    await this.write(`${MESSAGES}${message.conversationId}/${message.id}`, { ...message, delivery: next });
    this.changed();
  }

  /**
   * Stores a reaction once, even when the reacted message has not arrived yet
   * @throws if storage fails
   */
  async addReaction(conversationId: string, reaction: StoredNdrReaction): Promise<void> {
    const key = `${REACTIONS}${conversationId}/${reaction.id}`;
    if (this.records.has(key)) return;

    await this.write(key, reaction);
    this.changed();
  }

  /**
   * Records a peer receipt for sent messages, keeping the furthest state
   * @throws if storage fails
   */
  async addReceipt(conversationId: string, messageIds: string[], receipt: "delivered" | "seen"): Promise<void> {
    let updated = false;

    for (const id of messageIds) {
      const key = `${RECEIPTS}${conversationId}/${id}`;
      const previous = this.records.get(key) as "delivered" | "seen" | undefined;
      if (previous && laterDelivery(previous, receipt) === previous) continue;

      await this.write(key, receipt);
      updated = true;
    }

    if (updated) this.changed();
  }

  /**
   * Marks incoming messages up to a timestamp as seen locally
   * @throws if storage fails
   */
  async markRead(conversationId: string, until: number): Promise<void> {
    const key = `${READ}${conversationId}`;
    if (((this.records.get(key) as number | undefined) ?? 0) >= until) return;

    await this.write(key, until);
    this.changed();
  }

  /** Returns the timestamp of the last seen incoming message */
  lastRead(conversationId: string): number {
    return (this.records.get(`${READ}${conversationId}`) as number | undefined) ?? 0;
  }

  /**
   * Removes every message, reaction, receipt, and read marker for a conversation
   * @throws if storage fails
   */
  async clearConversation(conversationId: string): Promise<void> {
    const prefixes = [MESSAGES, REACTIONS, RECEIPTS].map((prefix) => `${prefix}${conversationId}/`);
    const keys = [...this.records.keys()].filter(
      (key) => prefixes.some((prefix) => key.startsWith(prefix)) || key === `${READ}${conversationId}`,
    );

    for (const key of keys) await this.remove(key);
    if (keys.length) this.changed();
  }

  /**
   * Removes messages whose expiration has passed and returns how many were removed
   * @throws if storage fails
   */
  async purgeExpired(): Promise<number> {
    const now = this.now();
    const expired = this.entries<StoredNdrMessage>(MESSAGES).filter(
      ([, message]) => message.expiresAt !== undefined && message.expiresAt <= now,
    );

    for (const [key] of expired) await this.remove(key);
    if (expired.length) this.changed();
    return expired.length;
  }

  /** Returns a conversation's unexpired messages, newest first, with reactions and receipts applied */
  messages(conversationId: string): NdrMessage[] {
    const now = this.now();

    const reactions = new Map<string, Record<string, string[]>>();
    for (const [, reaction] of this.entries<StoredNdrReaction>(`${REACTIONS}${conversationId}/`)) {
      const byContent = reactions.get(reaction.target) ?? {};
      const senders = byContent[reaction.content] ?? [];
      if (!senders.includes(reaction.sender)) byContent[reaction.content] = [...senders, reaction.sender];
      reactions.set(reaction.target, byContent);
    }

    return this.entries<StoredNdrMessage>(`${MESSAGES}${conversationId}/`)
      .map(([, message]) => message)
      .filter((message) => message.expiresAt === undefined || message.expiresAt > now)
      .map((message) => {
        const receipt = this.records.get(`${RECEIPTS}${conversationId}/${message.id}`) as NdrDeliveryState | undefined;
        const delivery =
          receipt && message.delivery !== "received" ? laterDelivery(message.delivery, receipt) : message.delivery;

        return { ...message, delivery, reactions: reactions.get(message.id) ?? {} };
      })
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
  }

  /** Returns a summary for every conversation with messages or a stored group, newest activity first */
  conversations(): NdrConversationSummary[] {
    const ids = new Set<string>();
    for (const [key] of this.entries(MESSAGES)) ids.add(key.slice(MESSAGES.length).split("/")[0]);
    for (const record of this.groups()) ids.add(getNdrGroupConversationId(record.data.id));

    const summaries = [...ids].map((id): NdrConversationSummary => {
      const groupId = getNdrGroupId(id);
      const messages = this.messages(id);
      const lastRead = this.lastRead(id);
      const unread = messages.filter((message) => message.delivery === "received" && message.createdAt > lastRead);

      return {
        id,
        type: groupId ? "group" : "direct",
        groupId,
        lastMessage: messages[0],
        unread: unread.length,
      };
    });

    const activity = (summary: NdrConversationSummary) => {
      if (summary.lastMessage) return summary.lastMessage.createdAt;

      // Group creation times are in milliseconds
      const groupCreatedAt = summary.groupId ? this.group(summary.groupId)?.data.createdAt : undefined;
      return Math.floor((groupCreatedAt ?? 0) / 1000);
    };
    return summaries.sort((a, b) => activity(b) - activity(a));
  }

  /** Returns a stored group */
  group(groupId: string): NdrGroupRecord | undefined {
    return this.records.get(`${GROUPS}${groupId}`) as NdrGroupRecord | undefined;
  }

  /** Returns every stored group */
  groups(): NdrGroupRecord[] {
    return this.entries<NdrGroupRecord>(GROUPS).map(([, record]) => record);
  }

  /**
   * Stores a group roster
   * @throws if storage fails
   */
  async putGroup(record: NdrGroupRecord): Promise<void> {
    await this.write(`${GROUPS}${record.data.id}`, record);
    this.changed();
  }

  /**
   * Removes a group and its history
   * @throws if storage fails
   */
  async removeGroup(groupId: string): Promise<void> {
    await this.remove(`${GROUPS}${groupId}`);
    await this.clearConversation(getNdrGroupConversationId(groupId));
    this.changed();
  }

  /** Returns the disappearing-message TTL in seconds for a peer, or null when disabled */
  ttl(peer: string): number | null {
    return (this.records.get(`${TTLS}${peer}`) as number | null | undefined) ?? null;
  }

  /**
   * Stores the disappearing-message TTL for a peer
   * @throws if storage fails
   */
  async setTtl(peer: string, ttl: number | null): Promise<void> {
    await this.write(`${TTLS}${peer}`, ttl);
    this.changed();
  }

  /** Returns the local label for a device */
  label(identityPubkey: string): string | undefined {
    return this.records.get(`${LABELS}${identityPubkey}`) as string | undefined;
  }

  /**
   * Stores or clears the local label for a device
   * @throws if storage fails
   */
  async setLabel(identityPubkey: string, label: string | undefined): Promise<void> {
    if (label) await this.write(`${LABELS}${identityPubkey}`, label);
    else await this.remove(`${LABELS}${identityPubkey}`);
    this.changed();
  }
}
