import { blankEventTemplate, EventFactory } from "applesauce-core/factories";
import { EventTemplate, kinds, NostrEvent, pipeFromAsyncArray } from "applesauce-core/helpers";
import { MetaTagOptions } from "applesauce-core/operations/event";
import { embedSharedEvent, setShareKind, setShareTags } from "../operations/share.js";
import { setZapSplit, ZapOptions } from "../operations/zap-split.js";

export type ShareBlueprintOptions = MetaTagOptions & ZapOptions;

/** A factory class for building NIP-18 repost/share events (kind 6/16) */
export class ShareFactory extends EventFactory<number, EventTemplate> {
  /**
   * Creates a new share factory
   * @param event - The event being shared
   * @returns A new share factory
   */
  static create(event: NostrEvent): ShareFactory {
    return new ShareFactory((res) => res(blankEventTemplate(kinds.Repost))).setEvent(event);
  }

  /** Creates a new share event for an existing event */
  static share(event: NostrEvent): ShareFactory {
    return ShareFactory.create(event);
  }

  /** Sets the event being shared */
  setEvent(event: NostrEvent) {
    return this.chain(
      pipeFromAsyncArray([
        // Set the kind
        setShareKind(event),
        // Then embed the event into the content
        embedSharedEvent(event),
        // Then set the reference tags
        setShareTags(event),
      ]),
    );
  }

  /** Sets zap split configuration */
  zapSplit(options: ZapOptions) {
    return this.chain(setZapSplit(options, undefined));
  }
}
