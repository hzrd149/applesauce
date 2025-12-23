import { firstValueFrom, TagOperation } from "applesauce-core";
import { kinds } from "applesauce-core/helpers/event";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { modifyPublicTags } from "applesauce-core/operations/tags";
import { of, timeout } from "rxjs";
import { Action } from "../action-runner.js";

function ModifyDirectMessageRelaysEvent(operations: TagOperation[]): Action {
  return async ({ events, factory, self, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(kinds.DirectMessageRelaysList, self)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    const operation = modifyPublicTags(...operations);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, operation).then(sign)
      : await factory.build({ kind: kinds.DirectMessageRelaysList }, operation).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a relay to the 10050 DM relays event */
export function AddDirectMessageRelay(relay: string | string[]): Action {
  return ModifyDirectMessageRelaysEvent([
    ...(Array.isArray(relay) ? relay.map((r) => addRelayTag(r)) : [addRelayTag(relay)]),
  ]);
}

/** An action that removes a relay from the 10050 DM relays event */
export function RemoveDirectMessageRelay(relay: string | string[]): Action {
  return ModifyDirectMessageRelaysEvent([
    ...(Array.isArray(relay) ? relay.map((r) => removeRelayTag(r)) : [removeRelayTag(relay)]),
  ]);
}

/** Creates a new DM relays event */
export function NewDirectMessageRelays(relays?: string[]): Action {
  return async ({ events, factory, self, user, publish, sign }) => {
    const dmRelays = events.getReplaceable(kinds.DirectMessageRelaysList, self);
    if (dmRelays) throw new Error("DM relays event already exists");

    const operations = relays?.map((r) => addRelayTag(r)) ?? [];
    const signed = await factory
      .build({ kind: kinds.DirectMessageRelaysList }, modifyPublicTags(...operations))
      .then(sign);
    await publish(signed, await user.outboxes$.$first(1000, undefined));
  };
}
