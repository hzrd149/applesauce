import { NostrEvent } from "applesauce-core/helpers/event";

/** Returns the NIP-36 content-warning for an event. returns boolean if there is no "reason" */
export function getContentWarning<E extends { tags: string[][] } = NostrEvent>(event: E): string | boolean {
  const tag = event.tags.find((t) => t[0] === "content-warning");

  if (tag) return tag[1] || true;
  else return false;
}
