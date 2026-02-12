import { EventFactory, blankEventTemplate } from "applesauce-core/factories";
import { KnownEventTemplate, NostrEvent } from "applesauce-core/helpers";
import { AddressPointer } from "applesauce-core/helpers/pointers";
import { MINT_RECOMMENDATION_KIND } from "../helpers/mint-recommendation.js";
import { setMintPubkey, setURL, setAddressPointer, setComment } from "../operations/mint-recommendation.js";

export type MintRecommendationTemplate = KnownEventTemplate<typeof MINT_RECOMMENDATION_KIND>;

export class MintRecommendationFactory extends EventFactory<typeof MINT_RECOMMENDATION_KIND, MintRecommendationTemplate> {
  static create(url: string, mintPubkey: string, mintInfo?: AddressPointer): MintRecommendationFactory {
    const factory = new MintRecommendationFactory((res) => res(blankEventTemplate(MINT_RECOMMENDATION_KIND)))
      .url(url)
      .mintPubkey(mintPubkey);
    return mintInfo ? factory.mintInfo(mintInfo) : factory;
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

// Legacy blueprint function for backwards compatibility
import type { EventTemplate } from "applesauce-core/helpers";

export function MintRecommendationBlueprint(options: {
  url: string;
  mintPubkey: string;
  mintInfo?: AddressPointer;
}) {
  return async (_services: any): Promise<EventTemplate> => {
    return MintRecommendationFactory.create(options.url, options.mintPubkey, options.mintInfo);
  };
}
