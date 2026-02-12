import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { isKind, kinds, KnownEventTemplate, NostrEvent, pipeFromAsyncArray } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { includePubkeyNotificationTags, setThreadParent } from "../operations/note.js";
import { ZapOptions } from "../operations/zap-split.js";

export type NoteTemplate = KnownEventTemplate<kinds.ShortTextNote>;
export type NoteBlueprintOptions = TextContentOptions & MetaTagOptions & ZapOptions;

/** A factory class for building kind 1 short text note events */
export class NoteFactory extends EventFactory<kinds.ShortTextNote, NoteTemplate> {
  /**
   * Creates a new note factory
   * @param content - Optional initial content
   * @returns A new note factory
   */
  static create(content?: string): NoteFactory {
    const factory = new NoteFactory((res) => res(blankEventTemplate(kinds.ShortTextNote)));
    return content ? factory.text(content) : factory;
  }

  /**
   * Creates a note reply factory
   * @param parent - The parent note to reply to
   * @param content - Optional initial content
   * @returns A new note factory configured as a reply
   */
  static reply(parent: NostrEvent, content?: string): NoteFactory {
    if (isKind(parent, kinds.ShortTextNote))
      throw new Error("Kind 1 replies should only be used to reply to kind 1 notes");

    const factory = new NoteFactory((res) => res(blankEventTemplate(kinds.ShortTextNote))).replyTo(parent);

    return content ? factory.text(content) : factory;
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
}
