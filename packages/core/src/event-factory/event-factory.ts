import { EventTemplate, NostrEvent, UnsignedEvent } from "../helpers/event.js";
import { sign, stamp } from "../operations/event.js";
import { modifyTags, ModifyTagsOptions } from "../operations/tags.js";
import { buildEvent, EventFactoryTemplate, modifyEvent } from "./methods.js";
import { EventBlueprint, EventFactoryServices, EventOperation, IEventFactory } from "./types.js";

/**
 * Base class that provides event creation functionality.
 * This class can be extended by other packages to add additional helpful event creation methods.
 *
 * @example
 * ```ts
 * // In another package (e.g., applesauce-common)
 * import { EventFactory } from "applesauce-core/event-factory";
 * import { NoteBlueprint, ReactionBlueprint } from "applesauce-common/blueprints";
 *
 * // Add methods to the prototype
 * EventFactory.prototype.note = function(content, options) {
 *   return this.create(NoteBlueprint, content, options);
 * };
 *
 * EventFactory.prototype.reaction = function(event, emoji) {
 *   return this.create(ReactionBlueprint, event, emoji);
 * };
 *
 * // Extend the type via module augmentation
 * declare module "applesauce-core/event-factory" {
 *   interface EventFactory {
 *     note(content: string, options?: NoteBlueprintOptions): Promise<EventTemplate>;
 *     reaction(event: NostrEvent, emoji?: string): Promise<EventTemplate>;
 *   }
 * }
 * ```
 */
export class EventFactory implements IEventFactory {
  constructor(public services: EventFactoryServices = {}) {}

  /** Build an event template with operations */
  async build(template: EventFactoryTemplate, ...operations: (EventOperation | undefined)[]): Promise<EventTemplate> {
    return await buildEvent(template, this.services, ...operations);
  }

  /** Create an event from a blueprint */
  async create<T extends EventTemplate | UnsignedEvent | NostrEvent>(blueprint: EventBlueprint<T>): Promise<T>;
  async create<T extends EventTemplate | UnsignedEvent | NostrEvent, Args extends Array<any>>(
    blueprint: (...args: Args) => EventBlueprint<T>,
    ...args: Args
  ): Promise<T>;
  async create<T extends EventTemplate | UnsignedEvent | NostrEvent, Args extends Array<any>>(
    blueprint: EventBlueprint<T> | ((...args: Args) => EventBlueprint<T>),
    ...args: Args
  ): Promise<T> {
    // services, blueprint(services)
    if (arguments.length === 1) {
      return (await blueprint(this.services)) as T;
    }
    // services, blueprintConstructor(...args)(services), ...args
    else {
      const constructor = blueprint as (...args: Args) => EventBlueprint<T>;
      return await constructor(...args)(this.services);
    }
  }

  /** Modify an existing event with operations and updated the created_at */
  async modify(
    draft: EventTemplate | UnsignedEvent | NostrEvent,
    ...operations: (EventOperation | undefined)[]
  ): Promise<EventTemplate> {
    return await modifyEvent(draft, this.services, ...operations);
  }

  /** Modify a lists public and hidden tags and updated the created_at */
  async modifyTags(
    event: EventTemplate | UnsignedEvent | NostrEvent,
    tagOperations?: ModifyTagsOptions,
    eventOperations?: EventOperation | (EventOperation | undefined)[],
  ): Promise<EventTemplate> {
    let eventOperationsArr: EventOperation[] = [];

    // normalize event operation arg
    if (eventOperations === undefined) eventOperationsArr = [];
    else if (typeof eventOperations === "function") eventOperationsArr = [eventOperations];
    else if (Array.isArray(eventOperations)) eventOperationsArr = eventOperations.filter((e) => !!e);

    // modify event
    return await this.modify(event, modifyTags(tagOperations, this.services.signer), ...eventOperationsArr);
  }

  /** Attaches the signers pubkey to an event template */
  async stamp(draft: EventTemplate | UnsignedEvent): Promise<UnsignedEvent> {
    return await stamp(this.services.signer)(draft);
  }

  /** Signs a event template with the signer */
  async sign(draft: EventTemplate | UnsignedEvent): Promise<NostrEvent> {
    return await sign(this.services.signer)(draft);
  }

  // Helpers

  /** Sets the signer in the services */
  setSigner(signer: EventFactoryServices["signer"]) {
    this.services.signer = signer;
  }

  /** clears the signer in the services */
  clearSigner() {
    this.services.signer = undefined;
  }

  /** sets the client in the services */
  setClient(client: EventFactoryServices["client"]) {
    this.services.client = client;
  }

  /** clears the client in the services */
  clearClient() {
    this.services.client = undefined;
  }

  /** sets relay hint functions in the services */
  setRelayHints(
    getEventRelayHint?: EventFactoryServices["getEventRelayHint"],
    getPubkeyRelayHint?: EventFactoryServices["getPubkeyRelayHint"],
  ) {
    this.services.getEventRelayHint = getEventRelayHint;
    this.services.getPubkeyRelayHint = getPubkeyRelayHint;
  }

  /** clears relay hint functions from the services */
  clearRelayHints() {
    this.services.getEventRelayHint = undefined;
    this.services.getPubkeyRelayHint = undefined;
  }

  /** sets emojis in the services */
  setEmojis(emojis?: EventFactoryServices["emojis"]) {
    this.services.emojis = emojis;
  }

  /** clears emojis from the services */
  clearEmojis() {
    this.services.emojis = undefined;
  }
}
