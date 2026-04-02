import { MailboxesFactory } from "applesauce-core/factories";
import { getOutboxes, relaySet } from "applesauce-core/helpers";
import { kinds, KnownEvent } from "applesauce-core/helpers/event";
import { Action, ActionContext } from "../action-runner.js";

async function modifyMailboxes({ user }: ActionContext): Promise<[MailboxesFactory, string[] | undefined]> {
  const mailboxes = await user.replaceable(kinds.RelayList).$first(1000, undefined);
  const factory = mailboxes
    ? MailboxesFactory.modify(mailboxes as KnownEvent<kinds.RelayList>)
    : MailboxesFactory.create();
  return [factory, mailboxes ? getOutboxes(mailboxes) : undefined];
}

/** An action to create a new kind 10002 relay list event */
export function CreateMailboxes(inboxes: string[], outboxes: string[]): Action {
  return async ({ signer, user, publish }) => {
    const mailboxes = await user.replaceable(kinds.RelayList).$first(1000, undefined);
    if (mailboxes) throw new Error("Mailbox event already exists");

    let factory = MailboxesFactory.create();
    for (const inbox of inboxes) factory = factory.addInbox(inbox);
    for (const outbox of outboxes) factory = factory.addOutbox(outbox);
    const signed = await factory.sign(signer);

    await publish(signed, relaySet(getOutboxes(signed)));
  };
}

/** An action to add an inbox relay to the kind 10002 relay list */
export function AddInboxRelay(relay: string | string[]): Action {
  const relays = Array.isArray(relay) ? relay : [relay];
  return async (context) => {
    const [factory, oldOutboxes] = await modifyMailboxes(context);
    let f = factory;
    for (const r of relays) f = f.addInbox(r);
    const signed = await f.sign(context.signer);

    // Publish to both old and new outboxes so the event propagates
    await context.publish(signed, relaySet(getOutboxes(signed), oldOutboxes));
  };
}

/** An action to remove an inbox relay from the kind 10002 relay list */
export function RemoveInboxRelay(relay: string | string[]): Action {
  const relays = Array.isArray(relay) ? relay : [relay];
  return async (context) => {
    const [factory, oldOutboxes] = await modifyMailboxes(context);
    if (!oldOutboxes) return;

    let f = factory;
    for (const r of relays) f = f.removeInbox(r);
    const signed = await f.sign(context.signer);

    await context.publish(signed, getOutboxes(signed));
  };
}

/** An action to add an outbox relay to the kind 10002 relay list */
export function AddOutboxRelay(relay: string | string[]): Action {
  const relays = Array.isArray(relay) ? relay : [relay];
  return async (context) => {
    const [factory, oldOutboxes] = await modifyMailboxes(context);
    let f = factory;
    for (const r of relays) f = f.addOutbox(r);
    const signed = await f.sign(context.signer);

    // Publish to both old and new outboxes so the event propagates
    await context.publish(signed, relaySet(getOutboxes(signed), oldOutboxes));
  };
}

/** An action to remove an outbox relay from the kind 10002 relay list */
export function RemoveOutboxRelay(relay: string | string[]): Action {
  const relays = Array.isArray(relay) ? relay : [relay];
  return async (context) => {
    const [factory, oldOutboxes] = await modifyMailboxes(context);
    if (!oldOutboxes) return;

    let f = factory;
    for (const r of relays) f = f.removeOutbox(r);
    const signed = await f.sign(context.signer);

    await context.publish(signed, getOutboxes(signed));
  };
}
