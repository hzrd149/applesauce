import { buildEvent, EventFactoryServices } from "applesauce-core/event-factory";
import { EventTemplate, kinds, NostrEvent } from "applesauce-core/helpers/event";
import { MetaTagOptions, setMetaTags, setShortTextContent, TextContentOptions } from "applesauce-core/operations";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";
import { includePubkeyNotificationTags, setThreadParent } from "../operations/note.js";

// Import EventFactory as a value (class) to modify its prototype
import { EventFactory } from "applesauce-core/event-factory";

export type NoteBlueprintOptions = TextContentOptions & MetaTagOptions & ZapOptions;

/** Short text note (kind 1) blueprint */
export function NoteBlueprint(content: string, options?: NoteBlueprintOptions) {
  return async (services: EventFactoryServices) => {
    return buildEvent(
      { kind: kinds.ShortTextNote },
      services,
      setShortTextContent(content, options),
      setZapSplit(options, services.getPubkeyRelayHint),
      setMetaTags(options),
    );
  };
}

/** Short text note reply (kind 1) blueprint */
export function NoteReplyBlueprint(parent: NostrEvent, content: string, options?: TextContentOptions) {
  if (parent.kind !== kinds.ShortTextNote)
    throw new Error("Kind 1 replies should only be used to reply to kind 1 notes");

  return async (services: EventFactoryServices) => {
    return buildEvent(
      { kind: kinds.ShortTextNote },
      services,
      // add NIP-10 tags
      setThreadParent(parent, services.getEventRelayHint),
      // copy "p" tags from parent
      includePubkeyNotificationTags(parent, services.getPubkeyRelayHint),
      // set default text content
      setShortTextContent(content, options),
    );
  };
}

// Register these blueprints with EventFactory
EventFactory.prototype.note = function (content: string, options?: NoteBlueprintOptions) {
  return this.create(NoteBlueprint, content, options);
};

EventFactory.prototype.noteReply = function (parent: NostrEvent, content: string, options?: TextContentOptions) {
  return this.create(NoteReplyBlueprint, parent, content, options);
};

// Type augmentation for EventFactory
declare module "applesauce-core/event-factory" {
  interface EventFactory {
    /** Create a short text note (kind 1) */
    note(content: string, options?: NoteBlueprintOptions): Promise<EventTemplate>;
    /** Create a short text note reply (kind 1) */
    noteReply(parent: NostrEvent, content: string, options?: TextContentOptions): Promise<EventTemplate>;
  }
}
