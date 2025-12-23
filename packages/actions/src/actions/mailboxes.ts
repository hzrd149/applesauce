import { getOutboxes, relaySet } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import {
  addInboxRelay,
  addOutboxRelay,
  removeInboxRelay,
  removeOutboxRelay,
} from "applesauce-core/operations/mailboxes";
import { Action } from "../action-runner.js";

/** An action to create a new kind 10002 relay list event */
export function CreateMailboxes(inboxes: string[], outboxes: string[]): Action {
  return async ({ factory, user, publish, sign }) => {
    const mailboxes = await user.replaceable(kinds.RelayList).$first(1000, undefined);
    if (mailboxes) throw new Error("Mailbox event already exists");

    const signed = await factory
      .build({ kind: kinds.RelayList }, ...inboxes.map(addInboxRelay), ...outboxes.map(addOutboxRelay))
      .then(sign);

    await publish(signed, relaySet(getOutboxes(signed)));
  };
}

/** An action to add an inbox relay to the kind 10002 relay list */
export function AddInboxRelay(relay: string | string[]): Action {
  return async ({ factory, user, publish, sign }) => {
    if (typeof relay === "string") relay = [relay];

    const mailboxes = await user.replaceable(kinds.RelayList).$first(1000, undefined);
    const signed = mailboxes
      ? await factory.modify(mailboxes, ...relay.map(addInboxRelay)).then(sign)
      : await factory.build({ kind: kinds.RelayList }, ...relay.map(addInboxRelay)).then(sign);

    // Publish the event to the old and new outboxes
    await publish(signed, relaySet(getOutboxes(signed), mailboxes && getOutboxes(mailboxes)));
  };
}

/** An action to remove an inbox relay from the kind 10002 relay list */
export function RemoveInboxRelay(relay: string | string[]): Action {
  return async ({ factory, user, publish, sign }) => {
    if (typeof relay === "string") relay = [relay];

    const mailboxes = await user.replaceable(kinds.RelayList).$first(1000, undefined);
    if (!mailboxes) return;

    const signed = await factory.modify(mailboxes, ...relay.map(removeInboxRelay)).then(sign);

    // Publish to outboxes
    await publish(signed, getOutboxes(signed));
  };
}

/** An action to add an outbox relay to the kind 10002 relay list */
export function AddOutboxRelay(relay: string | string[]): Action {
  return async ({ factory, user, publish, sign }) => {
    if (typeof relay === "string") relay = [relay];

    const mailboxes = await user.replaceable(kinds.RelayList).$first(1000, undefined);
    const signed = mailboxes
      ? await factory.modify(mailboxes, ...relay.map(addOutboxRelay)).then(sign)
      : await factory.build({ kind: kinds.RelayList }, ...relay.map(addOutboxRelay)).then(sign);

    // Publish to outboxes
    await publish(signed, getOutboxes(signed));
  };
}

/** An action to remove an outbox relay from the kind 10002 relay list */
export function RemoveOutboxRelay(relay: string | string[]): Action {
  return async ({ factory, user, publish, sign }) => {
    if (typeof relay === "string") relay = [relay];

    const mailboxes = await user.replaceable(kinds.RelayList).$first(1000, undefined);
    if (!mailboxes) return;

    const signed = await factory.modify(mailboxes, ...relay.map(removeOutboxRelay)).then(sign);

    // Publish to outboxes
    await publish(signed, getOutboxes(signed));
  };
}
