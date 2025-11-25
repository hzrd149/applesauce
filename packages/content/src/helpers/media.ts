import { MediaAttachment, getSha256FromURL } from "applesauce-common/helpers/file-metadata";

import { Tokens } from "./regexp.js";

/** Returns all URLs in a content string that contain a sha256 hash */
export function getMediaAttachmentURLsFromContent(content: string): MediaAttachment[] {
  return (
    Array.from(content.matchAll(Tokens.link))
      .map((match) => match[0])
      // filter out invalid URLs
      .filter((str) => URL.canParse(str))
      // convert to URLs
      .map((url) => new URL(url))
      // only keep urls with sha256 hashes in the
      .filter((url) => !!getSha256FromURL(url))
      // convert to media attachments
      .map((url) => ({ url: url.toString(), sha256: getSha256FromURL(url)! }) satisfies MediaAttachment)
  );
}
