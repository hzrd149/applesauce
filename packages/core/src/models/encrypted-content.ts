import { map, of } from "rxjs";
import { Model } from "../event-store/interface.js";
import { getEncryptedContent } from "../helpers/encrypted-content.js";
import { NostrEvent } from "../helpers/event.js";
import { watchEventUpdates } from "../observable/watch-event-updates.js";

/** A model that returns the encrypted content of an event or event id */
export function EncryptedContentModel(event: NostrEvent | string): Model<string | undefined> {
  return (events) =>
    (typeof event === "string" ? events.event(event) : of(event)).pipe(
      // Listen for updates to the event
      watchEventUpdates(events),
      // Get the encrypted content
      map((event) => event && getEncryptedContent(event)),
    );
}
