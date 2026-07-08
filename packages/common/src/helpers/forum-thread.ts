import { getTagValue, kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

/** NIP-7D forum thread kind (11) */
export const FORUM_THREAD_KIND = kinds.ForumThread;

/** Type for a validated NIP-7D forum thread event */
export type ForumThreadEvent = KnownEvent<typeof FORUM_THREAD_KIND>;

/** Returns a forum thread's title, if it has one (NIP-7D `title` tag) */
export function getForumThreadTitle(thread: ForumThreadEvent): string;
export function getForumThreadTitle(thread: NostrEvent): string | undefined;
export function getForumThreadTitle(thread: NostrEvent): string | undefined {
  return getTagValue(thread, "title");
}

/** Validates that an event is a NIP-7D forum thread (kind 11) */
export function isValidForumThread(thread: NostrEvent): thread is ForumThreadEvent {
  return thread.kind === FORUM_THREAD_KIND;
}
