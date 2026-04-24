import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { isKind, kinds, KnownEventTemplate, NostrEvent, pipeFromAsyncArray } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { includeNameValueTag } from "applesauce-core/operations/tags";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { ensureProfilePointerTag } from "applesauce-core/helpers/factory";
import { includePubkeyNotificationTags, setThreadParent } from "../operations/note.js";
import { addHashtag, includeHashtags } from "../operations/hashtags.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type NoteTemplate = KnownEventTemplate<kinds.ShortTextNote>;
export type NoteFactoryOptions = TextContentOptions & MetaTagOptions & ZapOptions;

/** A factory class for building kind 1 short text note events */
export class NoteFactory extends EventFactory<kinds.ShortTextNote, NoteTemplate> {
  /**
   * Creates a new note factory
   * @param content - Optional initial content
   * @param opts - Optional factory options
   * @returns A new note factory
   */
  static create(content?: string, opts?: NoteFactoryOptions): NoteFactory {
    let factory = new NoteFactory((res) => res(blankEventTemplate(kinds.ShortTextNote)));
    factory = content ? factory.text(content, opts) : factory;
    if (opts) factory = factory.meta(opts).zapSplit(opts);
    return factory;
  }

  /**
   * Creates a note reply factory
   * @param parent - The parent note to reply to
   * @param content - Optional initial content
   * @param opts - Optional factory options
   * @returns A new note factory configured as a reply
   */
  static reply(parent: NostrEvent, content?: string, opts?: NoteFactoryOptions): NoteFactory {
    if (!isKind(parent, kinds.ShortTextNote))
      throw new Error("Kind 1 replies should only be used to reply to kind 1 notes");

    let factory = new NoteFactory((res) => res(blankEventTemplate(kinds.ShortTextNote))).replyTo(parent);
    factory = content ? factory.text(content, opts) : factory;
    if (opts) factory = factory.meta(opts).zapSplit(opts);
    return factory;
  }

  /** Sets the parent note for NIP-10 threading */
  replyTo(parent: NostrEvent) {
    return this.chain(
      pipeFromAsyncArray([
        // Add the "e" tags for the thread
        setThreadParent(parent, undefined),
        // Copy the "p" tags from the parent event
        includePubkeyNotificationTags(parent, undefined),
      ]),
    );
  }

  /** Sets the text content with optional formatting */
  text(content: string, options?: TextContentOptions) {
    return this.chain(setShortTextContent(content, options));
  }

  /** Adds a "p" mention tag for a pubkey or ProfilePointer */
  mention(pubkey: string | ProfilePointer) {
    const pointer = typeof pubkey === "string" ? { pubkey } : pubkey;
    return this.modifyPublicTags((tags) => ensureProfilePointerTag(tags, pointer));
  }

  /** Sets the NIP-14 thread subject tag */
  subject(subject: string) {
    return this.chain(includeNameValueTag(["subject", subject]));
  }

  /** Adds a hashtag "t" tag */
  addHashtag(hashtag: string) {
    return this.chain(addHashtag(hashtag));
  }

  /** Adds multiple hashtags as "t" tags */
  hashtags(tags: string[]) {
    return this.chain(includeHashtags(tags));
  }

  /** Sets zap split configuration */
  zapSplit(options: ZapOptions) {
    return this.chain(setZapSplit(options, undefined));
  }
}
