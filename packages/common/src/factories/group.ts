import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { includeNameValueTag, includeSingletonTag } from "applesauce-core/operations/tags";
import { GROUP_MESSAGE_KIND, GROUP_THREAD_KIND, GroupPointer } from "../helpers/groups.js";
import { addPreviousRefs, setGroupPointer } from "../operations/group.js";
import { addHashtag, includeHashtags } from "../operations/hashtags.js";

export type GroupMessageTemplate = KnownEventTemplate<typeof GROUP_MESSAGE_KIND>;
export type GroupThreadTemplate = KnownEventTemplate<typeof GROUP_THREAD_KIND>;

export type GroupMessageFactoryOptions = TextContentOptions;

export class GroupMessageFactory extends EventFactory<typeof GROUP_MESSAGE_KIND, GroupMessageTemplate> {
  static create(group: GroupPointer, content: string, options?: GroupMessageFactoryOptions): GroupMessageFactory {
    return new GroupMessageFactory((res) => res(blankEventTemplate(GROUP_MESSAGE_KIND)))
      .group(group)
      .text(content, options);
  }

  group(pointer: GroupPointer) {
    return this.chain((draft) => setGroupPointer(pointer)(draft));
  }

  text(content: string, options?: TextContentOptions) {
    return this.chain((draft) => setShortTextContent(content, options)(draft));
  }

  previous(events: NostrEvent[]) {
    return this.chain((draft) => addPreviousRefs(events)(draft));
  }

  /** Sets the "e" reply tag pointing to a parent group message */
  replyTo(parent: NostrEvent) {
    return this.chain(includeNameValueTag(["e", parent.id]));
  }

  /** Creates a reply to a group message */
  static reply(
    group: GroupPointer,
    parent: NostrEvent,
    content: string,
    options?: GroupMessageFactoryOptions,
  ): GroupMessageFactory {
    return new GroupMessageFactory((res) => res(blankEventTemplate(GROUP_MESSAGE_KIND)))
      .group(group)
      .replyTo(parent)
      .text(content, options);
  }
}

export type GroupThreadFactoryOptions = TextContentOptions;

/** A factory class for building NIP-29 group thread events (kind 11) */
export class GroupThreadFactory extends EventFactory<typeof GROUP_THREAD_KIND, GroupThreadTemplate> {
  /** Creates a new group thread event */
  static create(
    group: GroupPointer,
    title: string,
    content: string,
    options?: GroupThreadFactoryOptions,
  ): GroupThreadFactory {
    return new GroupThreadFactory((res) => res(blankEventTemplate(GROUP_THREAD_KIND)))
      .group(group)
      .title(title)
      .text(content, options);
  }

  /** Sets the NIP-29 group pointer "h" tag */
  group(pointer: GroupPointer) {
    return this.chain(setGroupPointer(pointer));
  }

  /** Sets the thread title */
  title(title: string) {
    return this.chain(includeSingletonTag(["title", title]));
  }

  /** Sets the text content */
  text(content: string, options?: TextContentOptions) {
    return this.chain(setShortTextContent(content, options));
  }

  /** Adds a hashtag "t" tag to the thread */
  addHashtag(hashtag: string) {
    return this.chain(addHashtag(hashtag));
  }

  /** Adds multiple hashtags as "t" tags */
  hashtags(hashtags: string[]) {
    return this.chain(includeHashtags(hashtags));
  }
}
