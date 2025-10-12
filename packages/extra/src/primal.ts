import { mapEventsToTimeline } from "applesauce-core";
import { isEvent, type NostrEvent } from "applesauce-core/helpers";
import { completeOnEose, Relay, type RelayOptions } from "applesauce-relay";
import { filter, lastValueFrom, Observable } from "rxjs";

export const DEFAULT_PRIMAL_RELAY = "wss://cache2.primal.net/v1";

// ===== REQUEST/RESPONSE TYPES =====

type RequestAndResponse<M extends string, Args extends {}, Return> = {
  req: [M, Args];
  event: Return;
};
export type ExploreLegendCounts = RequestAndResponse<"explore_legend_counts", { pubkey: string }, NostrEvent>;
export type Explore = RequestAndResponse<
  "explore",
  {
    timeframe: "popular" | "trending" | "recent";
    pubkeys?: string[];
    limit?: number;
    created_after?: number;
    since?: number;
    until?: number;
    offset?: number;
    group_by_pubkey?: boolean;
    user_pubkey?: string;
    include_top_zaps?: boolean;
    apply_humaness_check?: boolean;
    gm_mode?: boolean;
  },
  NostrEvent
>;
export type ExploreGlobalTrending24h = RequestAndResponse<
  "explore_global_trending_24h",
  { limit?: number },
  NostrEvent
>;
export type ExploreGlobalMostZapped4h = RequestAndResponse<
  "explore_global_mostzapped_4h",
  { limit?: number },
  NostrEvent
>;
export type Scored = RequestAndResponse<
  "scored",
  {
    timeframe: "popular" | "trending" | "recent";
    pubkeys?: string[];
    limit?: number;
    created_after?: number;
    since?: number;
    until?: number;
    offset?: number;
    group_by_pubkey?: boolean;
    user_pubkey?: string;
    include_top_zaps?: boolean;
    apply_humaness_check?: boolean;
    gm_mode?: boolean;
  },
  NostrEvent
>;
export type ScoredUsers = RequestAndResponse<"scored_users", { limit?: number }, NostrEvent>;
export type ScoredUsers24h = RequestAndResponse<"scored_users_24h", { limit?: number }, NostrEvent>;
export type GetDefaultRelays = RequestAndResponse<"get_default_relays", {}, NostrEvent>;
export type GetRecommendedUsers = RequestAndResponse<"get_recommended_users", { limit?: number }, NostrEvent>;
export type GetSuggestedUsers = RequestAndResponse<"get_suggested_users", { limit?: number }, NostrEvent>;
export type UserProfileScoredContent = RequestAndResponse<
  "user_profile_scored_content",
  {
    pubkey: string;
    limit?: number;
    created_after?: number;
    since?: number;
    until?: number;
    offset?: number;
  },
  NostrEvent
>;
export type UserProfileScoredMediaThumbnails = RequestAndResponse<
  "user_profile_scored_media_thumbnails",
  {
    pubkey: string;
    limit?: number;
    created_after?: number;
    since?: number;
    until?: number;
    offset?: number;
  },
  NostrEvent
>;
export type Search = RequestAndResponse<
  "search",
  {
    query: string;
    limit?: number;
    since?: number;
    until?: number;
    offset?: number;
  },
  NostrEvent
>;
export type AdvancedSearch = RequestAndResponse<
  "advanced_search",
  {
    query: string;
    limit?: number;
    since?: number;
    until?: number;
    offset?: number;
    sort?: "latest" | "popular" | "trending";
  },
  NostrEvent
>;
export type AdvancedFeed = RequestAndResponse<
  "advanced_feed",
  {
    feed_type: string;
    limit?: number;
    since?: number;
    until?: number;
    offset?: number;
  },
  NostrEvent
>;
export type Relays = RequestAndResponse<"relays", {}, NostrEvent>;
export type GetNotifications = RequestAndResponse<
  "get_notifications",
  {
    pubkey: string;
    limit?: number;
    since?: number;
    until?: number;
    offset?: number;
  },
  NostrEvent
>;
export type SetNotificationsSeen = RequestAndResponse<
  "set_notifications_seen",
  { pubkey: string; until: number },
  NostrEvent
>;
export type GetNotificationsSeen = RequestAndResponse<"get_notifications_seen", { pubkey: string }, NostrEvent>;
export type UserSearch = RequestAndResponse<"user_search", { query: string; limit?: number }, NostrEvent>;
export type FeedDirective = RequestAndResponse<
  "feed_directive",
  {
    pubkey: string;
    feed_type: string;
    limit?: number;
    since?: number;
    until?: number;
    offset?: number;
  },
  NostrEvent
>;
export type FeedDirective2 = RequestAndResponse<
  "feed_directive_2",
  {
    pubkey: string;
    feed_type: string;
    limit?: number;
    since?: number;
    until?: number;
    offset?: number;
  },
  NostrEvent
>;
export type GetAdvancedFeeds = RequestAndResponse<"get_advanced_feeds", {}, NostrEvent>;
export type TrendingHashtags = RequestAndResponse<"trending_hashtags", { limit?: number }, NostrEvent>;
export type TrendingHashtags4h = RequestAndResponse<"trending_hashtags_4h", { limit?: number }, NostrEvent>;
export type TrendingHashtags7d = RequestAndResponse<"trending_hashtags_7d", { limit?: number }, NostrEvent>;
export type TrendingImages = RequestAndResponse<"trending_images", { limit?: number }, NostrEvent>;
export type TrendingImages4h = RequestAndResponse<"trending_images_4h", { limit?: number }, NostrEvent>;
export type ReportUser = RequestAndResponse<"report_user", { pubkey: string; reason: string }, NostrEvent>;
export type ReportNote = RequestAndResponse<"report_note", { event_id: string; reason: string }, NostrEvent>;
export type GetFilterlist = RequestAndResponse<"get_filterlist", {}, NostrEvent>;
export type CheckFilterlist = RequestAndResponse<"check_filterlist", { pubkeys: string[] }, NostrEvent>;
export type BroadcastReply = RequestAndResponse<"broadcast_reply", { event: NostrEvent }, NostrEvent>;
export type BroadcastEvents = RequestAndResponse<
  "broadcast_events",
  { events: NostrEvent[]; relays: string[] },
  NostrEvent
>;
export type TrustedUsers = RequestAndResponse<
  "trusted_users",
  { limit?: number; extended_response?: boolean },
  NostrEvent
>;
export type NoteMentions = RequestAndResponse<
  "note_mentions",
  {
    event_id?: string;
    pubkey?: string;
    identifier?: string;
    limit?: number;
    offset?: number;
    user_pubkey?: string;
  },
  NostrEvent
>;
export type NoteMentionsCount = RequestAndResponse<"note_mentions_count", { event_id: string }, NostrEvent>;
export type GetMediaMetadata = RequestAndResponse<"get_media_metadata", { urls: string[] }, NostrEvent>;

// Union type for all cache requests
export type CacheRequest =
  | ExploreLegendCounts
  | Explore
  | ExploreGlobalTrending24h
  | ExploreGlobalMostZapped4h
  | Scored
  | ScoredUsers
  | ScoredUsers24h
  | GetDefaultRelays
  | GetRecommendedUsers
  | GetSuggestedUsers
  | UserProfileScoredContent
  | UserProfileScoredMediaThumbnails
  | Search
  | AdvancedSearch
  | AdvancedFeed
  | Relays
  | GetNotifications
  | SetNotificationsSeen
  | GetNotificationsSeen
  | UserSearch
  | FeedDirective
  | FeedDirective2
  | GetAdvancedFeeds
  | TrendingHashtags
  | TrendingHashtags4h
  | TrendingHashtags7d
  | TrendingImages
  | TrendingImages4h
  | ReportUser
  | ReportNote
  | GetFilterlist
  | CheckFilterlist
  | BroadcastReply
  | BroadcastEvents
  | TrustedUsers
  | NoteMentions
  | NoteMentionsCount
  | GetMediaMetadata;

/**
 * Extended relay interface for primal caching server
 * @see https://github.com/PrimalHQ/primal-server/blob/main/src/app_ext.jl
 */
export class PrimalCache extends Relay {
  constructor(url = DEFAULT_PRIMAL_RELAY, opts?: RelayOptions) {
    super(url, opts);
  }

  /** Make a "cache" request to the caching server */
  cacheRequest<R extends CacheRequest>(request: CacheRequest["req"]): Observable<R["event"]> {
    return this.req({
      // @ts-expect-error
      cache: request,
    }).pipe(completeOnEose()) as unknown as Observable<R["event"]>;
  }

  /** Makes a cache request and returns a timeline of events */
  protected timelineRequest<R extends RequestAndResponse<any, any, any>>(
    method: R["req"][0],
    args: R["req"][1],
  ): Promise<R["event"][]> {
    return lastValueFrom(this.cacheRequest<R>([method, args]).pipe(mapEventsToTimeline()));
  }

  // ===== EXPLORE METHODS =====

  /** Get legend counts for explore page */
  exploreLegendCounts(pubkey: string): Promise<ExploreLegendCounts["event"][]> {
    return this.timelineRequest<ExploreLegendCounts>("explore_legend_counts", { pubkey });
  }

  /** Explore content with various filters */
  explore(params: Explore["req"][1]): Promise<Explore["event"][]> {
    return this.timelineRequest<Explore>("explore", params);
  }

  /** Get global trending content from last 24 hours */
  exploreGlobalTrending24h(limit = 20): Promise<ExploreGlobalTrending24h["event"][]> {
    return this.timelineRequest<ExploreGlobalTrending24h>("explore_global_trending_24h", { limit });
  }

  /** Get global most zapped content from last 4 hours */
  exploreGlobalMostZapped4h(limit = 20): Promise<ExploreGlobalMostZapped4h["event"][]> {
    return this.timelineRequest<ExploreGlobalMostZapped4h>("explore_global_mostzapped_4h", { limit });
  }

  // ===== SCORED CONTENT METHODS =====

  /** Get scored content */
  scored(params: Scored["req"][1]): Promise<Scored["event"][]> {
    return this.timelineRequest<Scored>("scored", params);
  }

  /** Get scored users */
  scoredUsers(limit = 20): Promise<ScoredUsers["event"][]> {
    return this.timelineRequest<ScoredUsers>("scored_users", { limit });
  }

  /** Get scored users from last 24 hours */
  scoredUsers24h(limit = 20): Promise<ScoredUsers24h["event"][]> {
    return this.timelineRequest<ScoredUsers24h>("scored_users_24h", { limit });
  }

  // ===== RELAY METHODS =====

  /** Get default relays */
  getDefaultRelays(): Promise<GetDefaultRelays["event"][]> {
    return this.timelineRequest<GetDefaultRelays>("get_default_relays", {});
  }

  // ===== USER METHODS =====

  /** Get recommended users */
  getRecommendedUsers(limit = 20): Promise<GetRecommendedUsers["event"][]> {
    return this.timelineRequest<GetRecommendedUsers>("get_recommended_users", { limit });
  }

  /** Get suggested users */
  getSuggestedUsers(limit = 20): Promise<GetSuggestedUsers["event"][]> {
    return this.timelineRequest<GetSuggestedUsers>("get_suggested_users", { limit });
  }

  /** Search for users by query */
  userSearch(query: string, limit = 10): Promise<UserSearch["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["user_search", { query, limit }]).pipe(
        // Ignore non events
        filter(isEvent),
        // Only accept profile kinds
        filter((e) => e.kind === 0),
        // Add to timeline
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get trusted users */
  trustedUsers(limit = 500, extendedResponse = true): Promise<TrustedUsers["event"][]> {
    return this.timelineRequest<TrustedUsers>("trusted_users", { limit, extended_response: extendedResponse });
  }

  // ===== PROFILE METHODS =====

  /** Get user profile scored content */
  userProfileScoredContent(params: UserProfileScoredContent["req"][1]): Promise<UserProfileScoredContent["event"][]> {
    return this.timelineRequest<UserProfileScoredContent>("user_profile_scored_content", params);
  }

  /** Get user profile scored media thumbnails */
  userProfileScoredMediaThumbnails(
    params: UserProfileScoredMediaThumbnails["req"][1],
  ): Promise<UserProfileScoredMediaThumbnails["event"][]> {
    return this.timelineRequest<UserProfileScoredMediaThumbnails>("user_profile_scored_media_thumbnails", params);
  }

  // ===== SEARCH METHODS =====

  /** Search content */
  search(params: Search["req"][1]): Promise<Search["event"][]> {
    return this.timelineRequest<Search>("search", params);
  }

  /** Advanced search */
  advancedSearch(params: AdvancedSearch["req"][1]): Promise<AdvancedSearch["event"][]> {
    return this.timelineRequest<AdvancedSearch>("advanced_search", params);
  }

  // ===== FEED METHODS =====

  /** Advanced feed */
  advancedFeed(params: AdvancedFeed["req"][1]): Promise<AdvancedFeed["event"][]> {
    return this.timelineRequest<AdvancedFeed>("advanced_feed", params);
  }

  /** Feed directive */
  feedDirective(params: FeedDirective["req"][1]): Promise<FeedDirective["event"][]> {
    return this.timelineRequest<FeedDirective>("feed_directive", params);
  }

  /** Feed directive v2 */
  feedDirective2(params: FeedDirective2["req"][1]): Promise<FeedDirective2["event"][]> {
    return this.timelineRequest<FeedDirective2>("feed_directive_2", params);
  }

  /** Get advanced feeds */
  getAdvancedFeeds(): Promise<GetAdvancedFeeds["event"][]> {
    return this.timelineRequest<GetAdvancedFeeds>("get_advanced_feeds", {});
  }

  // ===== TRENDING METHODS =====

  /** Get trending hashtags */
  trendingHashtags(limit = 20): Promise<TrendingHashtags["event"][]> {
    return this.timelineRequest<TrendingHashtags>("trending_hashtags", { limit });
  }

  /** Get trending hashtags from last 4 hours */
  trendingHashtags4h(limit = 20): Promise<TrendingHashtags4h["event"][]> {
    return this.timelineRequest<TrendingHashtags4h>("trending_hashtags_4h", { limit });
  }

  /** Get trending hashtags from last 7 days */
  trendingHashtags7d(limit = 20): Promise<TrendingHashtags7d["event"][]> {
    return this.timelineRequest<TrendingHashtags7d>("trending_hashtags_7d", { limit });
  }

  /** Get trending images */
  trendingImages(limit = 20): Promise<TrendingImages["event"][]> {
    return this.timelineRequest<TrendingImages>("trending_images", { limit });
  }

  /** Get trending images from last 4 hours */
  trendingImages4h(limit = 20): Promise<TrendingImages4h["event"][]> {
    return this.timelineRequest<TrendingImages4h>("trending_images_4h", { limit });
  }

  // ===== NOTIFICATION METHODS =====

  /** Get notifications */
  getNotifications(params: GetNotifications["req"][1]): Promise<GetNotifications["event"][]> {
    return this.timelineRequest<GetNotifications>("get_notifications", params);
  }

  /** Set notifications as seen */
  setNotificationsSeen(pubkey: string, until: number): Promise<SetNotificationsSeen["event"][]> {
    return this.timelineRequest<SetNotificationsSeen>("set_notifications_seen", { pubkey, until });
  }

  /** Get notifications seen status */
  getNotificationsSeen(pubkey: string): Promise<GetNotificationsSeen["event"][]> {
    return this.timelineRequest<GetNotificationsSeen>("get_notifications_seen", { pubkey });
  }

  // ===== RELAY METHODS =====

  /** Get relays */
  relays(): Promise<Relays["event"][]> {
    return this.timelineRequest<Relays>("relays", {});
  }

  // ===== REPORT METHODS =====

  /** Report user */
  reportUser(pubkey: string, reason: string): Promise<ReportUser["event"][]> {
    return this.timelineRequest<ReportUser>("report_user", { pubkey, reason });
  }

  /** Report note */
  reportNote(eventId: string, reason: string): Promise<ReportNote["event"][]> {
    return this.timelineRequest<ReportNote>("report_note", { event_id: eventId, reason });
  }

  // ===== FILTERLIST METHODS =====

  /** Get filterlist */
  getFilterlist(): Promise<GetFilterlist["event"][]> {
    return this.timelineRequest<GetFilterlist>("get_filterlist", {});
  }

  /** Check filterlist */
  checkFilterlist(pubkeys: string[]): Promise<CheckFilterlist["event"][]> {
    return this.timelineRequest<CheckFilterlist>("check_filterlist", { pubkeys });
  }

  // ===== BROADCAST METHODS =====

  /** Broadcast reply */
  broadcastReply(event: NostrEvent): Promise<BroadcastReply["event"][]> {
    return this.timelineRequest<BroadcastReply>("broadcast_reply", { event });
  }

  /** Broadcast events */
  broadcastEvents(events: NostrEvent[], relays: string[]): Promise<BroadcastEvents["event"][]> {
    return this.timelineRequest<BroadcastEvents>("broadcast_events", { events, relays });
  }

  // ===== MENTION METHODS =====

  /** Get note mentions */
  noteMentions(params: NoteMentions["req"][1]): Promise<NoteMentions["event"][]> {
    return this.timelineRequest<NoteMentions>("note_mentions", params);
  }

  /** Get note mentions count */
  noteMentionsCount(eventId: string): Promise<NoteMentionsCount["event"][]> {
    return this.timelineRequest<NoteMentionsCount>("note_mentions_count", { event_id: eventId });
  }

  // ===== MEDIA METHODS =====

  /** Get media metadata */
  getMediaMetadata(urls: string[]): Promise<GetMediaMetadata["event"][]> {
    return this.timelineRequest<GetMediaMetadata>("get_media_metadata", { urls });
  }
}
