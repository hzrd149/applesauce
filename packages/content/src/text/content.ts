import { Transformer, unified } from "unified";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { nostrMentions } from "./mentions.js";
import { emojis } from "./emoji.js";
import { createEventContentTree } from "./parser.js";
import { Root } from "../nast/types.js";
import { hashtags } from "./hashtag.js";
import { galleries } from "./gallery.js";
import { eolMetadata } from "../nast/eol-metadata.js";
import { links } from "./links.js";
import { blossomURIs } from "./blossom.js";

export const TextNoteContentSymbol = Symbol.for("text-note-content");

// default kind 1 transformers. Optional transformers (like `cashuTokens` and
// `lightningInvoices`) opt in by appending to this array when their module is
// imported — see `applesauce-content/text/cashu` and
// `applesauce-content/text/lightning`.
export const textNoteTransformers: (() => Transformer<Root>)[] = [
  blossomURIs,
  links,
  nostrMentions,
  galleries,
  emojis,
  hashtags,
  eolMetadata,
];

// Cache keys for custom transformer lists, so each list caches its own tree on the event
const transformerCacheKeys = new WeakMap<(() => Transformer<Root>)[], symbol>();

/** Gets the cache key used when no explicit key is passed for a list of transformers */
function getTransformersCacheKey(transformers: (() => Transformer<Root>)[]): symbol {
  if (transformers === textNoteTransformers) return TextNoteContentSymbol;

  let key = transformerCacheKeys.get(transformers);
  if (!key) transformerCacheKeys.set(transformers, (key = Symbol("parsed-content")));
  return key;
}

/**
 * Parses and processes a note with transformers, caching the result on the event
 * @param cacheKey The key to cache under, `null` disables caching. Defaults to a key for the transformer list, or no caching when `content` is overridden
 */
export function getParsedContent(
  event: NostrEvent | EventTemplate | string,
  content?: string,
  transformers: (() => Transformer<Root>)[] = textNoteTransformers,
  cacheKey?: symbol | null,
) {
  const parse = () => {
    const processor = unified();
    for (const transformer of transformers) {
      processor.use(transformer);
    }
    return processor.runSync(createEventContentTree(event, content)) as Root;
  };

  // process strings
  if (typeof event === "string") return parse();

  // A content override is not part of the default key, so it is only cached under an explicit key
  const key = cacheKey === undefined ? (content === undefined ? getTransformersCacheKey(transformers) : null) : cacheKey;

  // no caching
  if (!key) return parse();

  return getOrComputeCachedValue(event, key, parse);
}

export function removeParsedTextContent(event: NostrEvent | EventTemplate) {
  Reflect.deleteProperty(event, TextNoteContentSymbol);
}
