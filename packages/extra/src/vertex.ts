import { getTagValue, hasNameValueTag, LRU, unixNow } from "applesauce-core/helpers";
import { ProfilePointer } from "applesauce-core/helpers/pointers";
import { onlyEvents, Relay, type RelayOptions } from "applesauce-relay";
import { type ISigner } from "applesauce-signers";
import { combineLatest, filter, firstValueFrom, map, Subscription, take } from "rxjs";

export const VERTEX_RELAY = "wss://relay.vertexlab.io";
export const VERTEX_SEARCH_KIND = 5315;
export const VERTEX_VERIFY_REPUTATION_KIND = 5312;

export type SortMethod = "globalPagerank" | "personalizedPagerank" | "followerCount";

export type SearchProfileResult = ProfilePointer & { rank: number };

export type VerifyReputationResult = {
  pubkey: string;
  rank: number;
  follows?: number;
  followers?: number;
};

export type VerifyReputationOptions = {
  target: string;
  sort?: SortMethod;
  source?: string;
  limit?: number;
};

/** Extended relay class for interacting with the vertex relay */
export class Vertex extends Relay {
  private signer: ISigner;
  private autoAuth: Subscription;

  constructor(signer: ISigner, relay: string = VERTEX_RELAY, opts?: RelayOptions) {
    super(relay, opts);
    this.signer = signer;

    // Automatically authenticate to the relay when a challenge is received
    let authenticating = false;
    this.autoAuth = combineLatest([this.challenge$, this.authenticated$]).subscribe(([challenge, authenticated]) => {
      if (challenge && !authenticated && !authenticating) {
        console.info("[VERTEX] Authenticating to relay");
        authenticating = true;
        this.authenticate(this.signer).finally(() => (authenticating = false));
      }
    });
  }

  // Create a cache for user search results that expires after 1 hour
  protected userSearchCache = new LRU<ProfilePointer[]>(1000, 60 * 60 * 1000);

  /** Lookup user profiles by search query */
  async userSearch(
    query: string,
    sortMethod: SortMethod = "globalPagerank",
    limit: number = 10,
  ): Promise<ProfilePointer[]> {
    // Check cache
    const cached = this.userSearchCache.get([query, sortMethod, limit].join(":"));
    if (cached) return cached;

    // Create request
    const request = await this.signer.signEvent({
      kind: VERTEX_SEARCH_KIND,
      tags: [
        ["param", "search", query],
        ["param", "limit", limit.toString()],
        ["param", "source", await this.signer.getPublicKey()],
        ["param", "sort", sortMethod],
      ],
      created_at: unixNow(),
      content: "",
    });

    // send request
    await this.publish(request);

    // Wait for response
    const response = await firstValueFrom(
      this.subscription({
        kinds: [VERTEX_SEARCH_KIND + 1000, 7000],
        "#e": [request.id],
        "#p": [request.pubkey],
      }).pipe(
        onlyEvents(),
        // Only select response events
        filter((event) => hasNameValueTag(event, "e", request.id)),
        // Only accept error events for response
        filter((event) => (event.kind === 7000 ? getTagValue(event, "status") === "error" : true)),
      ),
    );

    const error =
      response.kind === 7000 ? response.tags.find((t) => t[0] === "status" && t[1] === "error")?.[2] : undefined;

    // Throw vertex error
    if (error) throw new Error(error);

    const pointers = (JSON.parse(response.content) as { pubkey: string; rank: number }[])
      // Sort by rank descending
      .sort((a, b) => b.rank - a.rank)
      // Convert to profile pointers
      .map(({ pubkey }) => ({
        pubkey,
        relays: [VERTEX_RELAY],
      }));

    // Cache the results
    this.userSearchCache.set([query, sortMethod, limit].join(":"), pointers);

    return pointers;
  }

  /** Verify reputation of a pubkey */
  async verifyReputation(options: VerifyReputationOptions): Promise<VerifyReputationResult[]> {
    const { target, sort = "globalPagerank", source, limit = 5 } = options;

    // Create request
    const request = await this.signer.signEvent({
      kind: VERTEX_VERIFY_REPUTATION_KIND,
      tags: [
        ["param", "target", target],
        ["param", "sort", sort],
        ["param", "limit", limit.toString()],
        ...(source ? [["param", "source", source]] : []),
      ],
      created_at: unixNow(),
      content: "",
    });

    // Send request
    await this.publish(request);

    // Wait for response
    const response = await firstValueFrom(
      this.subscription({
        kinds: [VERTEX_VERIFY_REPUTATION_KIND + 1000, 7000],
        "#e": [request.id],
        "#p": [request.pubkey],
      }).pipe(
        onlyEvents(),
        // Only select response events
        filter((event) => hasNameValueTag(event, "e", request.id)),
        // Only accept error events for response
        filter((event) => (event.kind === 7000 ? getTagValue(event, "status") === "error" : true)),
      ),
    );

    const error =
      response.kind === 7000 ? response.tags.find((t) => t[0] === "status" && t[1] === "error")?.[2] : undefined;

    // Throw vertex error
    if (error) throw new Error(error);

    // Parse and return the results
    const results = JSON.parse(response.content) as VerifyReputationResult[];
    return results;
  }

  /** Method to get credit balance on vertex */
  async getCreditBalance(): Promise<number> {
    return firstValueFrom(
      this.request({ kinds: [22243] }).pipe(
        take(1),
        map((e) => {
          const tag = e.tags.find((t) => t[0] === "credits");
          if (!tag) throw new Error("No credits tag found");
          return parseInt(tag?.[1] || "0");
        }),
      ),
    );
  }

  /** Close the connection to the relay */
  close() {
    this.autoAuth.unsubscribe();
    super.close();
  }
}
