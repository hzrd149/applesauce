import { blueprint } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { COMMENT_KIND } from "../helpers/comment.js";
import { setParent } from "../operations/comment.js";

export type CommentBlueprintOptions = TextContentOptions & MetaTagOptions;

/** A blueprint to create a NIP-22 comment event */
export function CommentBlueprint(parent: NostrEvent, content: string, options?: CommentBlueprintOptions) {
  return blueprint(COMMENT_KIND, setParent(parent), setShortTextContent(content, options), setMetaTags(options));
}
