import { EventFactory, blankEventTemplate, toEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { MINT_RECOMMENDATION_KIND } from "../helpers/mint-recommendation.js";
import { setMintPubkey, setURL, setAddressPointer, setComment } from "../operations/mint-recommendation.js";

export type MintRecommendationTemplate = KnownEventTemplate<typeof MINT_RECOMMENDATION_KIND>;

export class MintRecommendationFactory extends EventFactory<
  typeof MINT_RECOMMENDATION_KIND,
  MintRecommendationTemplate
> {
  static create(url: string, mintPubkey: string, mintInfo?: AddressPointer): MintRecommendationFactory {
    const factory = new MintRecommendationFactory((res) => res(blankEventTemplate(MINT_RECOMMENDATION_KIND)))
      .url(url)
      .mintPubkey(mintPubkey);
    return mintInfo ? factory.mintInfo(mintInfo) : factory;
  }

  /** Creates a new factory from an existing mint recommendation event */
  static modify(event: NostrEvent): MintRecommendationFactory {
    if (event.kind !== MINT_RECOMMENDATION_KIND) throw new Error("Event is not a mint recommendation event");
    return new MintRecommendationFactory((res) => res(toEventTemplate(event) as MintRecommendationTemplate));
  }

  url(url: string) {
    return this.chain((draft) => setURL(url)(draft));
  }

  mintPubkey(pubkey: string) {
    return this.chain((draft) => setMintPubkey(pubkey)(draft));
  }

  mintInfo(pointer: AddressPointer | NostrEvent | string) {
    return this.chain((draft) => setAddressPointer(pointer)(draft));
  }

  comment(text: string) {
    return this.chain((draft) => setComment(text)(draft));
  }
}
