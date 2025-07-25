import { FileMetadata } from "applesauce-core/helpers";
import { kinds } from "nostr-tools";

import { blueprint } from "../event-factory.js";
import { skip } from "../helpers/pipeline.js";
import { MetaTagOptions, setMetaTags } from "../operations/common.js";
import { setShortTextContent, TextContentOptions } from "../operations/content.js";
import { setFileMetadata } from "../operations/file-metadata.js";
import { includeHashtags } from "../operations/hashtags.js";

export type FileMetadataBlueprintOptions = TextContentOptions & MetaTagOptions & { hashtags?: string[] };

/** Blueprint to create a NIP-94 file metadata event */
export function FileMetadataBlueprint(
  metadata: FileMetadata,
  description?: string,
  options?: FileMetadataBlueprintOptions,
) {
  return blueprint(
    kinds.FileMetadata,
    setFileMetadata(metadata),
    description ? setShortTextContent(description, options) : skip(),
    options?.hashtags ? includeHashtags(options.hashtags) : skip(),
    setMetaTags(options),
  );
}
