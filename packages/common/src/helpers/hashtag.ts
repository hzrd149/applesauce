import { EventTemplate, NostrEvent } from "nostr-tools";
import { stripInvisibleChar } from "applesauce-core/helpers/string";

export function getHashtagTag(event: NostrEvent | EventTemplate, hashtag: string) {
  hashtag = stripInvisibleChar(hashtag.replace(/^#/, "").toLocaleLowerCase());

  return event.tags
    .filter((t) => t[0] === "t" && t[1])
    .find((t) => stripInvisibleChar(t[1].toLowerCase()) === hashtag) as ["t", string];
}
