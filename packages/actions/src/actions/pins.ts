import { PinListFactory } from "applesauce-common/factories";
import { kinds, NostrEvent } from "applesauce-core/helpers/event";
import { Action, ActionContext } from "../action-runner.js";

async function modifyPinList({ user }: ActionContext): Promise<[PinListFactory, string[] | undefined]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(kinds.Pinlist).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  return [event ? PinListFactory.modify(event) : PinListFactory.create(), outboxes];
}

export const ALLOWED_PIN_KINDS = [kinds.ShortTextNote, kinds.LongFormArticle];

/** An action that pins a note to the users pin list */
export function PinNote(note: NostrEvent): Action {
  if (!ALLOWED_PIN_KINDS.includes(note.kind)) throw new Error(`Event kind ${note.kind} can not be pinned`);
  return async (context) => {
    const [factory, outboxes] = await modifyPinList(context);
    const signed = await factory.pinEvent(note).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that removes an event from the users pin list */
export function UnpinNote(note: NostrEvent): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyPinList(context);
    const signed = await factory.unpinEvent(note).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}
