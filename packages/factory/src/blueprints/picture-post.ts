import { MediaAttachment, PICTURE_POST_KIND } from "applesauce-core/helpers";

import { blueprint } from "../event-factory.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setShortTextContent, TextContentOptions } from "../operations/content.js";
import { includeHashtags } from "../operations/hashtags.js";
import { addMediaAttachments } from "../operations/media-attachment.js";
import { setImageMetadata } from "../operations/picture-post.js";

export type PicturePostBlueprintOptions = TextContentOptions &
  MetaTagOptions & {
    hashtags?: string[];
  };

/**
 * A blueprint to create a kind 20 picture post
 * @see https://github.com/nostr-protocol/nips/blob/master/68.md
 * @throws {Error} if the pictures are not image/* types
 */
export function PicturePostBlueprint(
  pictures: MediaAttachment[],
  content: string,
  options?: PicturePostBlueprintOptions,
) {
  if (pictures.some((m) => !m.type?.includes("image/")))
    throw new Error("Only image/* types can be added to a picture post");

  return blueprint(
    PICTURE_POST_KIND,
    addMediaAttachments(pictures),
    setImageMetadata(pictures),
    setShortTextContent(content, options),
    setMetaTags(options),
    options?.hashtags ? includeHashtags(options.hashtags) : undefined,
  );
}
