import { serializeURL } from "applesauce-core/helpers/url";
import { MediaAttachment, getSha256FromURL } from "applesauce-common/helpers/file-metadata";
import { Tokens } from "applesauce-core/helpers/regexp";

/** Returns all URLs in a content string that contain a sha256 hash */
export function getMediaAttachmentURLsFromContent(content: string): MediaAttachment[] {
  const attachments: MediaAttachment[] = [];
  for (const match of content.matchAll(Tokens.link)) {
    try {
      const sha256 = getSha256FromURL(match[0]);
      if (sha256) attachments.push({ url: serializeURL(match[0]), sha256 });
    } catch {
      // Ignore invalid URLs.
    }
  }
  return attachments;
}
