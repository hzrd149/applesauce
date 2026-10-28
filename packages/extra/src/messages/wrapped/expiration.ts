import type { EventTemplate } from "applesauce-core/helpers";

/** Tracks the latest observed rumor lifetime in each wrapped-message conversation */
export class WrappedMessageExpirationTracker {
  private conversations = new Map<string, { createdAt: number; id: string; duration?: number }>();

  private conversationKey(participants: readonly string[]) {
    return JSON.stringify([...new Set(participants)].sort());
  }

  /** Records a message without letting older history replace newer preferences */
  observe(event: EventTemplate & { id: string }, participants: readonly string[]) {
    const key = this.conversationKey(participants);
    const previous = this.conversations.get(key);
    if (
      previous &&
      (previous.createdAt > event.created_at || (previous.createdAt === event.created_at && previous.id <= event.id))
    )
      return;

    // Parse strictly since getExpirationTimestamp accepts trailing junk like "999junk"
    const value = event.tags.find((tag) => tag[0] === "expiration")?.[1];
    const expiration = value && /^\d+$/.test(value) ? Number(value) : NaN;
    const duration = expiration - event.created_at;
    this.conversations.set(key, {
      createdAt: event.created_at,
      id: event.id,
      duration: Number.isSafeInteger(expiration) && duration > 0 ? duration : undefined,
    });
  }

  /** Returns an expiration timestamp using the latest message lifetime and the new timestamp */
  expiration(participants: readonly string[], createdAt: number): number | undefined {
    const duration = this.conversations.get(this.conversationKey(participants))?.duration;
    return duration === undefined ? undefined : createdAt + duration;
  }
}
