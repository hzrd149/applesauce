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
import { EventBlueprint, EventFactoryServices, EventOperation } from "./types.js";

export type EventFactoryTemplate = {
  kind: number;
  content?: string;
  tags?: string[][];
  created_at?: number;
};

/** Wraps a set of operations with common event operations */
function wrapCommon(services: EventFactoryServices, ...operations: (EventOperation | undefined)[]): EventOperation {
  return eventPipe(
    // Remove all symbols from the event except for the encrypted content symbol
    stripSymbols([EncryptedContentSymbol]),
    // Ensure all addressable events have "d" tags
    includeReplaceableIdentifier(),
    // Apply operations
    ...operations,
    // Include client tag if its set in the services
    services.client ? setClient(services.client.name, services.client.address) : undefined,
  );
}

/** Creates an event using a template, services, and a set of operations */
export async function buildEvent(
  template: EventFactoryTemplate,
  services: EventFactoryServices,
  ...operations: (EventOperation | undefined)[]
): Promise<EventTemplate> {
  return await wrapCommon(
    services,
    stripSignature(),
    stripStamp(),
    ...operations,
  )({
    created_at: unixNow(),
    tags: [],
    content: "",
    ...template,
  });
}

/** Creates a blueprint function with operations */
export function blueprint(kind: number, ...operations: (EventOperation | undefined)[]): EventBlueprint {
  return async (services) => await buildEvent({ kind }, services, ...operations);
}

/** Creates an event from services and a blueprint */
export async function createEvent<T extends EventTemplate | UnsignedEvent | NostrEvent>(
  services: EventFactoryServices,
  blueprint: EventBlueprint<T>,
): Promise<T>;
export async function createEvent<T extends EventTemplate | UnsignedEvent | NostrEvent, Args extends Array<any>>(
  services: EventFactoryServices,
  blueprintConstructor: (...args: Args) => EventBlueprint<T>,
  ...args: Args
): Promise<T>;
export async function createEvent<T extends EventTemplate | UnsignedEvent | NostrEvent, Args extends Array<any>>(
  services: EventFactoryServices,
  blueprint: EventBlueprint<T> | ((...args: Args) => EventBlueprint<T>),
  ...args: Args
): Promise<T> {
  // services, blueprint(services)
  if (arguments.length === 2) {
    return (await blueprint(services)) as T;
  }
  // services, blueprintConstructor(...args)(services), ...args
  else {
    const constructor = blueprint as (...args: Args) => EventBlueprint<T>;
    return await constructor(...args)(services);
  }
}

/** Modifies an event using services and a set of operations */
export async function modifyEvent(
  event: EventTemplate | UnsignedEvent | NostrEvent,
  services: EventFactoryServices,
  ...operations: (EventOperation | undefined)[]
): Promise<EventTemplate> {
  // NOTE: Unwrapping event object in order to handle cast events from applesauce-common
  if ("event" in event && isEvent(event.event)) event = event.event as typeof event;

  return await wrapCommon(services, stripSignature(), stripStamp(), updateCreatedAt(), ...operations)(event);
}
