import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { Emoji } from "applesauce-core/event-factory";

// Import EventFactory as a value (class) to modify its prototype
// Using a side-effect import to ensure the class is available
import { EventFactory } from "applesauce-core/event-factory";

import { CommentBlueprint, CommentBlueprintOptions } from "./comment.js";
import { DeleteBlueprint } from "./delete.js";
import { NoteBlueprint, NoteBlueprintOptions, NoteReplyBlueprint } from "./note.js";
import { ReactionBlueprint } from "./reaction.js";
import { ShareBlueprint, ShareBlueprintOptions } from "./share.js";
import { TextContentOptions } from "applesauce-core/operations/content";

/**
 * Extends EventFactory with common helpful event creation methods.
 * This modifies the prototype of EventFactory to add methods for common blueprints.
 *
 * This module should be imported to register the common helpful event creation methods.
 * Simply importing this module will add the methods to EventFactory.
 */
// Add methods to EventFactory prototype
EventFactory.prototype.note = function (content: string, options?: NoteBlueprintOptions) {
  return this.create(NoteBlueprint, content, options);
};

EventFactory.prototype.noteReply = function (parent: NostrEvent, content: string, options?: TextContentOptions) {
  return this.create(NoteReplyBlueprint, parent, content, options);
};

EventFactory.prototype.comment = function (parent: NostrEvent, content: string, options?: CommentBlueprintOptions) {
  return this.create(CommentBlueprint, parent, content, options);
};

EventFactory.prototype.reaction = function (event: NostrEvent, emoji: string | Emoji = "+") {
  return this.create(ReactionBlueprint, event, emoji);
};

EventFactory.prototype.share = function (event: NostrEvent, options?: ShareBlueprintOptions) {
  return this.create(ShareBlueprint, event, options);
};

EventFactory.prototype.delete = function (events: NostrEvent[], reason?: string) {
  return this.create(DeleteBlueprint, events, reason);
};

/**
 * Type augmentation for EventFactory to include common helpful event creation methods.
 * This extends the type definition to include the methods added to the prototype.
 */
declare module "applesauce-core/event-factory" {
  interface EventFactory {
    /** Create a short text note (kind 1) */
    note(content: string, options?: NoteBlueprintOptions): Promise<EventTemplate>;
    /** Create a short text note reply (kind 1) */
    noteReply(parent: NostrEvent, content: string, options?: TextContentOptions): Promise<EventTemplate>;
    /** Create a NIP-22 comment event */
    comment(parent: NostrEvent, content: string, options?: CommentBlueprintOptions): Promise<EventTemplate>;
    /** Create a kind 7 reaction event */
    reaction(event: NostrEvent, emoji?: string | Emoji): Promise<EventTemplate>;
    /** Create a NIP-18 repost event */
    share(event: NostrEvent, options?: ShareBlueprintOptions): Promise<EventTemplate>;
    /** Create a NIP-09 delete event */
    delete(events: NostrEvent[], reason?: string): Promise<EventTemplate>;
  }
}
