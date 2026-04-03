import { hasHiddenTags, HiddenContentSigner } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { watchEventUpdates } from "applesauce-core/observable";
import { combineLatest, map, of, switchMap } from "rxjs";
import {
  FavoriteEmojisEvent,
  getFavoriteEmojis,
  getFavoriteEmojiPackPointers,
  getHiddenFavoriteEmojis,
  getHiddenFavoriteEmojiPackPointers,
  isHiddenFavoriteEmojiPacksUnlocked,
  isValidFavoriteEmojiPacks,
  unlockHiddenFavoriteEmojiPacks,
} from "../helpers/emoji-pack.js";
import { castTimelineStream } from "../observable/cast-stream.js";
import { CastRefEventStore, EventCast } from "./cast.js";
import { EmojiPack } from "./emoji-pack.js";

type HiddenFavoriteEmojiPacks = {
  emojis: ReturnType<typeof getFavoriteEmojis>;
  packPointers: AddressPointer[];
};

export class FavoriteEmojis extends EventCast<FavoriteEmojisEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidFavoriteEmojiPacks(event)) throw new Error("Invalid favorite emoji packs list");
    super(event, store);
  }

  get emojis() {
    return getFavoriteEmojis(this.event);
  }
  get packPointers() {
    return getFavoriteEmojiPackPointers(this.event);
  }

  get hiddenEmojis() {
    return getHiddenFavoriteEmojis(this.event);
  }
  get hiddenPackPointers() {
    return getHiddenFavoriteEmojiPackPointers(this.event);
  }
  get hidden$() {
    return this.$$ref("hidden$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => {
          if (!event) return undefined;

          const emojis = getHiddenFavoriteEmojis(event);
          const packPointers = getHiddenFavoriteEmojiPackPointers(event);
          if (!emojis || !packPointers) return undefined;

          return { emojis, packPointers } satisfies HiddenFavoriteEmojiPacks;
        }),
      ),
    );
  }

  get packs$() {
    return this.$$ref("packs$", (store) => {
      if (this.packPointers.length === 0) return of([]);

      return combineLatest(this.packPointers.map((pointer) => store.replaceable(pointer))).pipe(
        map((events) => events.filter((event) => !!event)),
        castTimelineStream(EmojiPack, store),
      );
    });
  }
  get hiddenPacks$() {
    return this.$$ref("hiddenPacks$", (store) =>
      this.hidden$.pipe(
        switchMap((hidden) => {
          if (hidden === undefined) return of(undefined);
          if (hidden.packPointers.length === 0) return of([]);

          return combineLatest(hidden.packPointers.map((pointer) => store.replaceable(pointer))).pipe(
            map((events) => events.filter((event) => !!event)),
            castTimelineStream(EmojiPack, store),
          );
        }),
      ),
    );
  }

  get hasHidden() {
    return hasHiddenTags(this.event);
  }
  get unlocked() {
    return isHiddenFavoriteEmojiPacksUnlocked(this.event);
  }
  async unlock(signer: HiddenContentSigner) {
    return unlockHiddenFavoriteEmojiPacks(this.event, signer);
  }
}
