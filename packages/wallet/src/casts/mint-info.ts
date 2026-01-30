import { CastRefEventStore, EventCast } from "applesauce-common/casts";
import { castTimelineStream } from "applesauce-common/observable";
import { NostrEvent } from "applesauce-core/helpers/event";
import {
  CashuMintInfoEvent,
  getCashuMintMetadata,
  getCashuMintNetwork,
  getCashuMintNuts,
  getCashuMintPubkey,
  getCashuMintURL,
  isValidCashuMintInfo,
} from "../helpers/mint-info.js";
import { MINT_RECOMMENDATION_KIND } from "../helpers/mint-recommendation.js";
import { MintRecommendation } from "./mint-recommendation.js";

/** A cast for a NIP-87 cashu mint info event */
export class MintInfo extends EventCast<CashuMintInfoEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidCashuMintInfo(event)) {
      throw new Error("Invalid cashu mint info event");
    }
    super(event, store);
  }

  /** The mint's pubkey (from the `d` tag) */
  get mintPubkey() {
    return getCashuMintPubkey(this.event);
  }

  /** The URL to the cashu mint (from the `u` tag) */
  get url() {
    return getCashuMintURL(this.event);
  }

  /** The supported nuts (comma-separated list of nut numbers) */
  get nuts() {
    return getCashuMintNuts(this.event);
  }

  /** The network type (mainnet, testnet, signet, or regtest) */
  get network() {
    return getCashuMintNetwork(this.event);
  }

  /** Optional metadata content (kind:0-style JSON object) */
  get metadata() {
    return getCashuMintMetadata(this.event);
  }

  get recomendations$() {
    return this.$$ref("recomendations$", (store) =>
      store
        .timeline(
          [
            // Based on the mint URL
            { kinds: [MINT_RECOMMENDATION_KIND], "#u": [this.url] },
            // Based on the mint pubkey
            this.mintPubkey ? { kinds: [MINT_RECOMMENDATION_KIND], "#d": [this.mintPubkey] } : undefined,
          ].filter((f) => !!f),
        )
        .pipe(castTimelineStream(MintRecommendation, store)),
    );
  }
}
