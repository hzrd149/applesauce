import { EncryptedContentSymbol } from "../helpers/encrypted-content.js";
import { EventTemplate, isEvent, NostrEvent, UnsignedEvent } from "../helpers/event.js";
import { eventPipe } from "../helpers/pipeline.js";
import { unixNow } from "../helpers/time.js";
import { setClient } from "../operations/client.js";
import {
  includeReplaceableIdentifier,
  stripSignature,
  stripStamp,
  stripSymbols,
  updateCreatedAt,
} from "../operations/event.js";
import { EventBlueprint, EventFactoryContext, EventOperation } from "./types.js";

export type EventFactoryTemplate = {
  kind: number;
  content?: string;
  tags?: string[][];
  created_at?: number;
};

/** Wraps a set of operations with common event operations */
function wrapCommon(...operations: (EventOperation | undefined)[]): EventOperation {
  return eventPipe(
    // Remove all symbols from the event except for the encrypted content symbol
    stripSymbols([EncryptedContentSymbol]),
    // Ensure all addressable events have "d" tags
    includeReplaceableIdentifier(),
    // Apply operations
    ...operations,
    // Include client tag if its set in the context
    (draft, ctx) => (ctx?.client ? setClient(ctx.client.name, ctx.client.address)(draft, ctx) : draft),
  );
}

/** Creates an event using a template, context, and a set of operations */
export async function buildEvent(
  template: EventFactoryTemplate,
  context: EventFactoryContext,
  ...operations: (EventOperation | undefined)[]
): Promise<EventTemplate> {
  return await wrapCommon(
    stripSignature(),
    stripStamp(),
    ...operations,
  )({ created_at: unixNow(), tags: [], content: "", ...template }, context);
}

/** Creates a blueprint function with operations */
export function blueprint(kind: number, ...operations: (EventOperation | undefined)[]): EventBlueprint {
  return async (context) => await buildEvent({ kind }, context, ...operations);
}

/** Creates an event from a context and a blueprint */
export async function createEvent<T extends EventTemplate | UnsignedEvent | NostrEvent>(
  context: EventFactoryContext,
  blueprint: EventBlueprint<T>,
): Promise<T>;
export async function createEvent<T extends EventTemplate | UnsignedEvent | NostrEvent, Args extends Array<any>>(
  context: EventFactoryContext,
  blueprintConstructor: (...args: Args) => EventBlueprint<T>,
  ...args: Args
): Promise<T>;
export async function createEvent<T extends EventTemplate | UnsignedEvent | NostrEvent, Args extends Array<any>>(
  context: EventFactoryContext,
  blueprint: EventBlueprint<T> | ((...args: Args) => EventBlueprint<T>),
  ...args: Args
): Promise<T> {
  // Context, blueprint(context)
  if (arguments.length === 2) {
    return (await blueprint(context)) as T;
  }
  // Context, blueprintConstructor(...args)(context), ...args
  else {
    const constructor = blueprint as (...args: Args) => EventBlueprint<T>;
    return await constructor(...args)(context);
  }
}

/** Modifies an event using a context and a set of operations */
export async function modifyEvent(
  event: EventTemplate | UnsignedEvent | NostrEvent,
  context: EventFactoryContext,
  ...operations: (EventOperation | undefined)[]
): Promise<EventTemplate> {
  // NOTE: Unwrapping evnet object in order to handle cast events from applesauce-common
  if ("event" in event && isEvent(event.event)) event = event.event as typeof event;

  return await wrapCommon(stripSignature(), stripStamp(), updateCreatedAt(), ...operations)(event, context);
}
