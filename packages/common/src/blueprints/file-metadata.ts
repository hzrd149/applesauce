import { blueprint } from "applesauce-core/event-factory";
import { kinds } from "applesauce-core/helpers/event";
import { skip } from "applesauce-core/helpers/pipeline";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { FileMetadata } from "../helpers/file-metadata.js";
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
