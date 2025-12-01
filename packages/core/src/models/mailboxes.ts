import { map } from "rxjs/operators";
import { Model } from "../event-store/interface.js";
import { kinds } from "../helpers/event.js";
import { getInboxes, getOutboxes } from "../helpers/mailboxes.js";
import { ProfilePointer } from "../helpers/pointers.js";

/** A model that gets and parses the inbox and outbox relays for a pubkey */
export function MailboxesModel(
  user: string | ProfilePointer,
): Model<{ inboxes: string[]; outboxes: string[] } | undefined> {
  if (typeof user === "string") user = { pubkey: user };

  return (events) =>
    events.replaceable({ kind: kinds.RelayList, pubkey: user.pubkey, relays: user.relays }).pipe(
      map(
        (event) =>
          event && {
            inboxes: getInboxes(event),
            outboxes: getOutboxes(event),
          },
      ),
    );
}
