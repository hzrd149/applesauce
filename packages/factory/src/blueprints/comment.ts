import { COMMENT_KIND } from "applesauce-common/helpers/comment";
import { NostrEvent } from "applesauce-core/helpers/event";

import { blueprint } from "../event-factory.js";
import { setParent } from "../operations/comment.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setShortTextContent, TextContentOptions } from "../operations/content.js";

export type CommentBlueprintOptions = TextContentOptions & MetaTagOptions;

/** A blueprint to create a NIP-22 comment event */
export function CommentBlueprint(parent: NostrEvent, content: string, options?: CommentBlueprintOptions) {
  return blueprint(COMMENT_KIND, setParent(parent), setShortTextContent(content, options), setMetaTags(options));
}
