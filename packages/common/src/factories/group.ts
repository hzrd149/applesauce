import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { setShortTextContent, TextContentOptions } from "applesauce-core/operations/content";
import { MetaTagOptions, setMetaTags } from "applesauce-core/operations/event";
import { GROUP_MESSAGE_KIND, GroupPointer } from "../helpers/groups.js";
import { addPreviousRefs, setGroupPointer } from "../operations/group.js";

export type GroupMessageTemplate = KnownEventTemplate<typeof GROUP_MESSAGE_KIND>;

export class GroupMessageFactory extends EventFactory<typeof GROUP_MESSAGE_KIND, GroupMessageTemplate> {
  static create(group: GroupPointer, content: string): GroupMessageFactory {
    return new GroupMessageFactory((res) => res(blankEventTemplate(GROUP_MESSAGE_KIND)))
      .group(group)
      .text(content);
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

  meta(options: MetaTagOptions) {
    return this.chain((draft) => setMetaTags(options)(draft));
  }
}
