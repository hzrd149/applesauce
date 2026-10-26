import { NappletHandlersFactory } from "applesauce-common/factories";
import { parseNappletConvention } from "applesauce-common/helpers/napplet";
import { NAPPLET_HANDLERS_KIND } from "applesauce-common/helpers/napplet-handlers";
import type { NappletHandlerInput } from "applesauce-common/operations/napplet-handlers";
import { hasHiddenTags } from "applesauce-core/helpers/hidden-tags";
import type { Action, ActionContext } from "../action-runner.js";

/** Loads the user's handler preferences for an archetype and their outboxes */
async function modifyNappletHandlers(
  { user }: ActionContext,
  archetype: string,
): Promise<[NappletHandlersFactory, string[] | undefined, boolean]> {
  const [event, outboxes] = await Promise.all([
    user.replaceable(NAPPLET_HANDLERS_KIND, archetype).$first(1000, undefined),
    user.outboxes$.$first(1000, undefined),
  ]);

  const factory = event ? NappletHandlersFactory.modify(event) : NappletHandlersFactory.create(archetype);
  return [factory, outboxes, !!event && hasHiddenTags(event)];
}

/**
 * Returns the archetype of a `napplet:<archetype>/<intent>` convention identity
 * @throws if the identity is invalid
 */
function getIntentArchetype(identity: string): string {
  const convention = parseNappletConvention(identity);
  if (!convention) throw new Error(`Invalid napplet convention identity: ${identity}`);

  return convention.archetype;
}

/** An action that adds a napplet as the last fallback handler for an archetype */
export function AddNappletHandler(archetype: string, napplet: NappletHandlerInput, hidden = false): Action {
  return async (context) => {
    const [factory, outboxes] = await modifyNappletHandlers(context, archetype);

    const signed = await factory.handler(napplet, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that makes a napplet the preferred handler for an archetype, publicly or privately */
export function SetNappletHandler(archetype: string, napplet: NappletHandlerInput, hidden = false): Action {
  return async (context) => {
    const [factory, outboxes, hasHidden] = await modifyNappletHandlers(context, archetype);

    // Keep the napplet in one group so its public or private visibility is unambiguous
    let draft = factory.preferHandler(napplet, hidden);
    if (hidden) draft = draft.removeHandler(napplet);
    else if (hasHidden) draft = draft.removeHandler(napplet, true);

    await context.publish(await draft.sign(context.signer), outboxes);
  };
}

/** An action that removes a napplet from the public and private handlers of an archetype */
export function RemoveNappletHandler(archetype: string, napplet: NappletHandlerInput): Action {
  return async (context) => {
    const [factory, outboxes, hasHidden] = await modifyNappletHandlers(context, archetype);

    let draft = factory.removeHandler(napplet);
    if (hasHidden) draft = draft.removeHandler(napplet, true);

    await context.publish(await draft.sign(context.signer), outboxes);
  };
}

/** An action that adds a napplet as the last fallback handler for a `napplet:<archetype>/<intent>` identity */
export function AddNappletIntentHandler(identity: string, napplet: NappletHandlerInput, hidden = false): Action {
  const archetype = getIntentArchetype(identity);

  return async (context) => {
    const [factory, outboxes] = await modifyNappletHandlers(context, archetype);

    const signed = await factory.intentHandler(identity, napplet, hidden).sign(context.signer);
    await context.publish(signed, outboxes);
  };
}

/** An action that makes a napplet the preferred handler for a `napplet:<archetype>/<intent>` identity */
export function SetNappletIntentHandler(identity: string, napplet: NappletHandlerInput, hidden = false): Action {
  const archetype = getIntentArchetype(identity);

  return async (context) => {
    const [factory, outboxes, hasHidden] = await modifyNappletHandlers(context, archetype);

    // Keep the napplet in one group so its public or private visibility is unambiguous
    let draft = factory.preferIntentHandler(identity, napplet, hidden);
    if (hidden) draft = draft.removeIntentHandler(identity, napplet);
    else if (hasHidden) draft = draft.removeIntentHandler(identity, napplet, true);

    await context.publish(await draft.sign(context.signer), outboxes);
  };
}

/** An action that removes one napplet, or every napplet when none is given, from the public and private handlers of an intent */
export function RemoveNappletIntentHandler(identity: string, napplet?: NappletHandlerInput): Action {
  const archetype = getIntentArchetype(identity);

  return async (context) => {
    const [factory, outboxes, hasHidden] = await modifyNappletHandlers(context, archetype);

    let draft = factory.removeIntentHandler(identity, napplet);
    if (hasHidden) draft = draft.removeIntentHandler(identity, napplet, true);

    await context.publish(await draft.sign(context.signer), outboxes);
  };
}

/** An action that removes every public and private handler for an archetype by publishing empty preferences */
export function ClearNappletHandlers(archetype: string): Action {
  return async (context) => {
    const [event, outboxes] = await Promise.all([
      context.user.replaceable(NAPPLET_HANDLERS_KIND, archetype).$first(1000, undefined),
      context.user.outboxes$.$first(1000, undefined),
    ]);
    if (!event) return;

    const signed = await NappletHandlersFactory.modify(event).clear().sign(context.signer);
    await context.publish(signed, outboxes);
  };
}
