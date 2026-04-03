import { getReplaceableIdentifier, NostrEvent } from "applesauce-core/helpers/event";
import {
  EmojiPackEvent,
  getEmojiPackDescription,
  getEmojiPackEmojis,
  getEmojiPackName,
  isValidEmojiPack,
} from "../helpers/emoji-pack.js";
import { CastRefEventStore, EventCast } from "./cast.js";

export class EmojiPack extends EventCast<EmojiPackEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidEmojiPack(event)) throw new Error("Invalid emoji pack");
    super(event, store);
  }

  get identifier() {
    return getReplaceableIdentifier(this.event)!;
  }
  get name() {
    return getEmojiPackName(this.event);
  }
  get title() {
    return this.name;
  }
  get description() {
    return getEmojiPackDescription(this.event);
  }
  get emojis() {
    return getEmojiPackEmojis(this.event);
  }
}
