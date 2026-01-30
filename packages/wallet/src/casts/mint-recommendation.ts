import { CastRefEventStore, EventCast } from "applesauce-common/casts";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  getRecommendationAddressPointer,
  getRecommendationMintPubkey,
  getRecommendationKind,
  getRecommendationURL,
  isValidMintRecommendation,
  MintRecommendationEvent,
} from "../helpers/mint-recommendation.js";

/** A cast for a NIP-87 mint recommendation event */
export class MintRecommendation extends EventCast<MintRecommendationEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidMintRecommendation(event)) throw new Error("Invalid mint recommendation event");
    super(event, store);
  }

  /** The recommended event kind (should be 38172 for cashu mints) */
  get kind() {
    return getRecommendationKind(this.event);
  }

  /** The mint's pubkey (from the `d` tag) */
  get mintPubkey() {
    return getRecommendationMintPubkey(this.event);
  }

  /** Optional URL to connect to the cashu mint (from the `u` tag) */
  get url() {
    return getRecommendationURL(this.event);
  }

  /** Optional address pointer to the kind:38172 event (from the `a` tag) */
  get addressPointer() {
    return getRecommendationAddressPointer(this.event);
  }

  /** Optional review content */
  get comment() {
    return this.event.content;
  }
}
