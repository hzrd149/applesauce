import { isTTag } from "applesauce-core/helpers";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { stripInvisibleChar } from "applesauce-core/helpers/string";

/** Returns a matching ["t", string] tag for a hashtag in an event */
export function getHashtagTag(event: NostrEvent | EventTemplate, hashtag: string) {
  hashtag = stripInvisibleChar(hashtag.replace(/^#/, "").toLocaleLowerCase());

  return event.tags.filter(isTTag).find((t) => stripInvisibleChar(t[1].toLowerCase()) === hashtag) as ["t", string];
}
