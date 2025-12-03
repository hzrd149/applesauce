import { NostrEvent } from "applesauce-core/helpers/event";

/** Returns the NIP-36 content-warning for an event. returns boolean if there is no "reason" */
export function getContentWarning(event: NostrEvent): string | boolean {
  const tag = event.tags.find((t) => t[0] === "content-warning");

  if (tag) return tag[1] || true;
  else return false;
}
