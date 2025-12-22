import { blueprint } from "applesauce-core/event-factory";
import { NostrEvent, EventTemplate } from "applesauce-core/helpers/event";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { COMMENT_KIND, CommentPointer } from "../helpers/comment.js";
import { setParent } from "../operations/comment.js";

// Import EventFactory as a value (class) to modify its prototype
import { EventFactory } from "applesauce-core/event-factory";

export type CommentBlueprintOptions = TextContentOptions & MetaTagOptions;

/** A blueprint to create a NIP-22 comment event */
export function CommentBlueprint(
  parent: NostrEvent | CommentPointer,
  content: string,
  options?: CommentBlueprintOptions,
) {
  return blueprint(COMMENT_KIND, setParent(parent), setShortTextContent(content, options), setMetaTags(options));
}

// Register this blueprint with EventFactory
EventFactory.prototype.comment = function (
  parent: NostrEvent | CommentPointer,
  content: string,
  options?: CommentBlueprintOptions,
) {
  return this.create(CommentBlueprint, parent, content, options);
};

// Type augmentation for EventFactory
declare module "applesauce-core/event-factory" {
  interface EventFactory {
    /** Create a NIP-22 comment event */
    comment(
      parent: NostrEvent | CommentPointer,
      content: string,
      options?: CommentBlueprintOptions,
    ): Promise<EventTemplate>;
  }
}
