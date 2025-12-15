import { defined, watchEventUpdates } from "applesauce-core";
import { hasHiddenTags } from "applesauce-core/helpers";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { map, of } from "rxjs";
import {
  getHiddenMutedThings,
  getPublicMutedThings,
  isHiddenMutesUnlocked,
  isValidMuteList,
  MuteListEvent,
  unlockHiddenMutes,
  type MutedThings,
} from "../helpers/mute.js";
import { EventCast } from "./cast.js";

/** Class for mute lists (kind 10000) */
export class Mutes extends EventCast<MuteListEvent> implements MutedThings {
  constructor(event: MuteListEvent) {
    if (!isValidMuteList(event)) throw new Error("Invalid mute list");
    super(event);
  }

  get mutes() {
    return getPublicMutedThings(this.event);
  }

  get hashtags() {
    return this.mutes.hashtags;
  }
  get words() {
    return this.mutes.words;
  }
  get pubkeys() {
    return this.mutes.pubkeys;
  }
  get threads() {
    return this.mutes.threads;
  }

  /** Get the unlocked hidden mutes */
  get hidden() {
    return getHiddenMutedThings(this.event);
  }
  /** An observable that updates when hidden mutes are unlocked */
  get hidden$() {
    return this.$$ref("hidden$", (store) =>
      of(this.event).pipe(
        // Watch for event updates
        watchEventUpdates(store),
        // Get hidden mutes
        map((event) => event && getHiddenMutedThings(event)),
        // Only emit when the hidden mutes are unlocked
        defined(),
      ),
    );
  }
  /** Whether the mute list has hidden mutes */
  get hasHidden() {
    return hasHiddenTags(this.event);
  }
  /** Whether the mute list is unlocked */
  get unlocked() {
    return isHiddenMutesUnlocked(this.event);
  }
  /** Unlocks the hidden mutes on the mute list */
  unlock(signer: HiddenContentSigner) {
    return unlockHiddenMutes(this.event, signer);
  }
}
