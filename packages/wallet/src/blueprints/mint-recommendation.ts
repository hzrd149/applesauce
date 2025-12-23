import { blueprint, EventBlueprint } from "applesauce-core/event-factory";
import { skip } from "applesauce-core/helpers";
import { NostrEvent } from "applesauce-core/helpers/event";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { MINT_RECOMMENDATION_KIND } from "../helpers/mint-recommendation.js";
import { CASHU_MINT_INFO_KIND } from "../helpers/mint-info.js";
import { setAddressPointer, setComment, setKind, setMintPubkey, setURL } from "../operations/mint-recommendation.js";

/** Options for creating a mint recommendation */
export type MintRecommendationOptions = {
  /** The mint's pubkey (from the kind:38172 event's `d` tag) - required */
  mintPubkey: string;
  /** Optional URL to connect to the cashu mint */
  url?: string;
  /** Optional address pointer to the kind:38172 event */
  addressPointer?: AddressPointer | NostrEvent | string;
  /** Optional review/comment content */
  comment?: string;
};

/** A blueprint to create a kind:38000 mint recommendation event */
export function MintRecommendationBlueprint(options: MintRecommendationOptions): EventBlueprint {
  const { mintPubkey, url, addressPointer, comment } = options;

  return blueprint(
    MINT_RECOMMENDATION_KIND,
    setKind(CASHU_MINT_INFO_KIND), // Always 38172 for cashu mints
    setMintPubkey(mintPubkey),
    url ? setURL(url) : skip(),
    addressPointer ? setAddressPointer(addressPointer) : skip(),
    comment ? setComment(comment) : skip(),
  );
}
