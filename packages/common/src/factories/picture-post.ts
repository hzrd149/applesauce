import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { FileMetadataFields } from "../helpers/file-metadata.js";
import { PICTURE_POST_KIND } from "../helpers/picture-post.js";
import { setImageMetadata } from "../operations/picture-post.js";
import { addMediaAttachments } from "../operations/media-attachment.js";
import { addHashtag, includeHashtags } from "../operations/hashtags.js";

export type PicturePostTemplate = KnownEventTemplate<typeof PICTURE_POST_KIND>;
export type PicturePostFactoryOptions = TextContentOptions;

/** A factory class for building kind 20 picture post events */
export class PicturePostFactory extends EventFactory<typeof PICTURE_POST_KIND, PicturePostTemplate> {
  /**
   * Creates a new picture post factory
   * @param attachments - One or more image attachments
   * @param caption - Optional caption text
   * @param options - Optional content
   */
  static create(
    attachments: FileMetadataFields | FileMetadataFields[],
    caption?: string,
    options?: PicturePostFactoryOptions,
  ): PicturePostFactory {
    const list = Array.isArray(attachments) ? attachments : [attachments];
    let factory = new PicturePostFactory((res) => res(blankEventTemplate(PICTURE_POST_KIND))).attachments(list);
    if (caption) factory = factory.caption(caption, options);
    return factory;
  }

  /** Adds image attachments via "imeta" tags */
  attachments(attachments: FileMetadataFields[]) {
    return this.chain(addMediaAttachments(attachments));
  }

  /** Sets the image metadata (x/m tags) for the post */
  imageMetadata(pictures: FileMetadataFields[]) {
    return this.chain(setImageMetadata(pictures));
  }

  /** Sets the caption/content of the picture post */
  caption(text: string, options?: TextContentOptions) {
    return this.chain(setShortTextContent(text, options));
  }

  /** Adds a hashtag "t" tag to the post */
  addHashtag(hashtag: string) {
    return this.chain(addHashtag(hashtag));
  }

  /** Adds multiple hashtags as "t" tags */
  hashtags(tags: string[]) {
    return this.chain(includeHashtags(tags));
  }
}
