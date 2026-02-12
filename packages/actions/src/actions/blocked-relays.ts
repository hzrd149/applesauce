import { EventOperation, firstValueFrom, TagOperation } from "applesauce-core";
import { kinds } from "applesauce-core/helpers/event";
import { modifyHiddenTags, modifyPublicTags } from "applesauce-core/operations";
import { addRelayTag, removeRelayTag } from "applesauce-core/operations/tag/relay";
import { of, timeout } from "rxjs";
import { Action } from "../action-runner.js";

// Action to generally modify the blocked relays event
function ModifyBlockedRelaysEvent(operations: EventOperation[]): Action {
  return async ({ events, factory, user, publish, sign }) => {
    const [event, outboxes] = await Promise.all([
      firstValueFrom(
        events
          .replaceable(kinds.BlockedRelaysList, user.pubkey)
          .pipe(timeout({ first: 1000, with: () => of(undefined) })),
      ),
      user.outboxes$.$first(1000, undefined),
    ]);

    // Modify or build new event
    const signed = event
      ? await factory.modify(event, ...operations).then(sign)
      : await factory.build({ kind: kinds.BlockedRelaysList }, ...operations).then(sign);

    // Publish the event to the user's outboxes
    await publish(signed, outboxes);
  };
}

/** An action that adds a relay to the 10006 blocked relays event */
export function AddBlockedRelay(relay: string | string[], hidden = false): Action {
  return async ({ run, factory }) => {
    const tagOperations: TagOperation[] = Array.isArray(relay)
      ? relay.map((r) => addRelayTag(r))
      : [addRelayTag(relay)];
    const operation = hidden
      ? modifyHiddenTags(factory.services.signer, ...tagOperations)
      : modifyPublicTags(...tagOperations);

    await run(ModifyBlockedRelaysEvent, [operation]);
  };
}

/** An action that removes a relay from the 10006 blocked relays event */
export function RemoveBlockedRelay(relay: string | string[], hidden = false): Action {
  return async ({ run, factory }) => {
    const tagOperations: TagOperation[] = Array.isArray(relay)
      ? relay.map((r) => removeRelayTag(r))
      : [removeRelayTag(relay)];
    const operation = hidden
      ? modifyHiddenTags(factory.services.signer, ...tagOperations)
      : modifyPublicTags(...tagOperations);

    await run(ModifyBlockedRelaysEvent, [operation]);
  };
}
