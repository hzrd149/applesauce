import { MintInfo, Wallet } from "@cashu/cashu-ts";
import { Action } from "applesauce-actions";
import { NostrEvent } from "applesauce-core/helpers/event";
import { MintRecommendationBlueprint } from "../factories/mint-recommendation.js";
import { getCashuMintPubkey, getCashuMintURL, isValidCashuMintInfo } from "../helpers/mint-info.js";
import {
  MINT_RECOMMENDATION_KIND,
  getRecommendationMintPubkey,
  isValidMintRecommendation,
} from "../helpers/mint-recommendation.js";
import { setComment } from "../operations/mint-recommendation.js";

// Helper function to fetch mint pubkey from URL
async function fetchMintPubkey(mintUrl: string): Promise<string> {
  // Fetch mint info directly from the /v1/info endpoint
  const infoUrl = new URL("/v1/info", mintUrl).toString();
  const response = await fetch(infoUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch mint info from ${mintUrl}: ${response.statusText}`);
  }
  const mintInfo = (await response.json()) as MintInfo;
  return mintInfo.pubkey;
}

// Make sure the mint recommendation cast is registered
import "../casts/__register__.js";

/**
 * Options for reviewing a mint
 */
export type ReviewMintOptions = {
  /** Optional review/comment content */
  comment?: string;
  /** Optional relays to publish to */
  relays?: string[];
};

/**
 * An action that creates and publishes a mint recommendation event.
 * Can accept a mint URL, Wallet instance, or MintInfo event.
 */
export function RecommendMint(input: string | Wallet | NostrEvent, options?: ReviewMintOptions): Action {
  return async ({ factory, sign, publish }) => {
    let mintPubkey: string;
    let url: string | undefined;
    let addressPointer: NostrEvent | undefined = undefined;

    // Handle different input types
    if (typeof input === "string") {
      if (!URL.canParse(input)) throw new Error("Invalid mint URL");
      // Input is a mint URL - fetch info directly
      url = input;
      mintPubkey = await fetchMintPubkey(url);
    } else if (input instanceof Wallet) {
      const info = input.getMintInfo();
      mintPubkey = info.pubkey;
    } else {
      // Input is a MintInfo event (kind:38172)
      if (!isValidCashuMintInfo(input))
        throw new Error("Invalid mint info event. Expected kind:38172 with required `d` and `u` tags.");

      mintPubkey = getCashuMintPubkey(input)!;
      url = getCashuMintURL(input);
      // Use the event itself as address pointer (blueprint will convert it)
      addressPointer = input;
    }

    // Create the mint recommendation event
    const recommendation = await factory
      .create(MintRecommendationBlueprint, {
        mintPubkey,
        url: url || "",
        addressPointer,
        comment: options?.comment,
      })
      .then(sign);

    // Publish the event
    await publish(recommendation, options?.relays);
  };
}

/**
 * Options for updating a mint recommendation
 */
export type UpdateMintRecommendationOptions = {
  /** Optional relays to publish to */
  relays?: string[];
};

/**
 * An action that updates the comment on an existing mint recommendation event.
 * Can accept a mint pubkey (to find the recommendation) or the recommendation event directly.
 */
export function UpdateMintRecommendation(
  input: string | NostrEvent,
  comment: string,
  options?: UpdateMintRecommendationOptions,
): Action {
  return async ({ events, factory, self, sign, publish }) => {
    let recommendation: NostrEvent | undefined;

    // Handle different input types
    if (typeof input === "string") {
      // Input is a mint pubkey - find the recommendation event
      const recommendations = events.getTimeline({ kinds: [MINT_RECOMMENDATION_KIND], authors: [self] });
      recommendation = recommendations.find((rec) => {
        if (!isValidMintRecommendation(rec)) return false;
        const recMintPubkey = getRecommendationMintPubkey(rec);
        return recMintPubkey === input;
      });

      if (!recommendation) throw new Error(`No mint recommendation found for mint pubkey: ${input}`);
    } else {
      // Input is a recommendation event
      if (!isValidMintRecommendation(input)) throw new Error("Invalid mint recommendation event");
      // Verify the event belongs to the current user
      if (input.pubkey !== self) throw new Error("Cannot update a mint recommendation that belongs to another user");

      recommendation = input;
    }

    // Update the comment
    const updated = await factory.modify(recommendation, setComment(comment)).then(sign);

    // Publish the updated event
    await publish(updated, options?.relays);
  };
}
