import { Transformer, unified } from "unified";
import { EventTemplate, NostrEvent } from "applesauce-core/helpers/event";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { nostrMentions } from "./mentions.js";
import { cashuTokens } from "./cashu.js";
import { emojis } from "./emoji.js";
import { createEventContentTree } from "./parser.js";
import { Root } from "../nast/types.js";
import { hashtags } from "./hashtag.js";
import { galleries } from "./gallery.js";
import { lightningInvoices } from "./lightning.js";
import { eolMetadata } from "../nast/eol-metadata.js";
import { links } from "./links.js";

export const TextNoteContentSymbol = Symbol.for("text-note-content");

// default kind 1 transformers
export const textNoteTransformers = [
  links,
  nostrMentions,
  galleries,
  emojis,
  hashtags,
  lightningInvoices,
  cashuTokens,
  eolMetadata,
];

/** Parsed and process a note with custom transformers */
export function getParsedContent(
  event: NostrEvent | EventTemplate | string,
  content?: string,
  transformers: (() => Transformer<Root>)[] = textNoteTransformers,
  cacheKey: symbol | null | undefined = TextNoteContentSymbol,
) {
  // process strings
  if (typeof event === "string") {
    const processor = unified();
    for (const transformer of transformers) {
      processor.use(transformer);
    }
    return processor.runSync(createEventContentTree(event, content)) as Root;
  }

  // no caching
  if (!cacheKey) {
    const processor = unified();
    for (const transformer of transformers) {
      processor.use(transformer);
    }
    return processor.runSync(createEventContentTree(event, content)) as Root;
  }

  return getOrComputeCachedValue(event, cacheKey, () => {
    const processor = unified();
    for (const transformer of transformers) {
      processor.use(transformer);
    }
    return processor.runSync(createEventContentTree(event, content)) as Root;
  });
}

export function removeParsedTextContent(event: NostrEvent | EventTemplate) {
  Reflect.deleteProperty(event, TextNoteContentSymbol);
}
