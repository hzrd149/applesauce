import { mapEventsToTimeline } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers";
import { completeOnEose, Relay, type RelayOptions } from "applesauce-relay";
import { lastValueFrom, Observable } from "rxjs";

export const DEFAULT_PRIMAL_RELAY = "wss://cache2.primal.net/v1";

// ===== REQUEST/RESPONSE TYPES =====

export type ExploreLegendCounts = {
  req: ["explore_legend_counts", { pubkey: string }];
  event: NostrEvent;
};

export type Explore = {
  req: [
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
  ];
  event: NostrEvent;
};

export type ExploreGlobalTrending24h = {
  req: ["explore_global_trending_24h", { limit?: number }];
  event: NostrEvent;
};

export type ExploreGlobalMostZapped4h = {
  req: ["explore_global_mostzapped_4h", { limit?: number }];
  event: NostrEvent;
};

export type Scored = {
  req: [
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
  ];
  event: NostrEvent;
};

export type ScoredUsers = {
  req: ["scored_users", { limit?: number }];
  event: NostrEvent;
};

export type ScoredUsers24h = {
  req: ["scored_users_24h", { limit?: number }];
  event: NostrEvent;
};

export type GetDefaultRelays = {
  req: ["get_default_relays", {}];
  event: NostrEvent;
};

export type GetRecommendedUsers = {
  req: ["get_recommended_users", { limit?: number }];
  event: NostrEvent;
};

export type GetSuggestedUsers = {
  req: ["get_suggested_users", { limit?: number }];
  event: NostrEvent;
};

export type UserProfileScoredContent = {
  req: [
    "user_profile_scored_content",
    {
      pubkey: string;
      limit?: number;
      created_after?: number;
      since?: number;
      until?: number;
      offset?: number;
    },
  ];
  event: NostrEvent;
};

export type UserProfileScoredMediaThumbnails = {
  req: [
    "user_profile_scored_media_thumbnails",
    {
      pubkey: string;
      limit?: number;
      created_after?: number;
      since?: number;
      until?: number;
      offset?: number;
    },
  ];
  event: NostrEvent;
};

export type Search = {
  req: [
    "search",
    {
      query: string;
      limit?: number;
      since?: number;
      until?: number;
      offset?: number;
    },
  ];
  event: NostrEvent;
};

export type AdvancedSearch = {
  req: [
    "advanced_search",
    {
      query: string;
      limit?: number;
      since?: number;
      until?: number;
      offset?: number;
      sort?: "latest" | "popular" | "trending";
    },
  ];
  event: NostrEvent;
};

export type AdvancedFeed = {
  req: [
    "advanced_feed",
    {
      feed_type: string;
      limit?: number;
      since?: number;
      until?: number;
      offset?: number;
    },
  ];
  event: NostrEvent;
};

export type Relays = {
  req: ["relays", {}];
  event: NostrEvent;
};

export type GetNotifications = {
  req: [
    "get_notifications",
    {
      pubkey: string;
      limit?: number;
      since?: number;
      until?: number;
      offset?: number;
    },
  ];
  event: NostrEvent;
};

export type SetNotificationsSeen = {
  req: ["set_notifications_seen", { pubkey: string; until: number }];
  event: NostrEvent;
};

export type GetNotificationsSeen = {
  req: ["get_notifications_seen", { pubkey: string }];
  event: NostrEvent;
};

export type UserSearch = {
  req: ["user_search", { query: string; limit?: number }];
  event: NostrEvent;
};

export type FeedDirective = {
  req: [
    "feed_directive",
    {
      pubkey: string;
      feed_type: string;
      limit?: number;
      since?: number;
      until?: number;
      offset?: number;
    },
  ];
  event: NostrEvent;
};

export type FeedDirective2 = {
  req: [
    "feed_directive_2",
    {
      pubkey: string;
      feed_type: string;
      limit?: number;
      since?: number;
      until?: number;
      offset?: number;
    },
  ];
  event: NostrEvent;
};

export type GetAdvancedFeeds = {
  req: ["get_advanced_feeds", {}];
  event: NostrEvent;
};

export type TrendingHashtags = {
  req: ["trending_hashtags", { limit?: number }];
  event: NostrEvent;
};

export type TrendingHashtags4h = {
  req: ["trending_hashtags_4h", { limit?: number }];
  event: NostrEvent;
};

export type TrendingHashtags7d = {
  req: ["trending_hashtags_7d", { limit?: number }];
  event: NostrEvent;
};

export type TrendingImages = {
  req: ["trending_images", { limit?: number }];
  event: NostrEvent;
};

export type TrendingImages4h = {
  req: ["trending_images_4h", { limit?: number }];
  event: NostrEvent;
};

export type ReportUser = {
  req: ["report_user", { pubkey: string; reason: string }];
  event: NostrEvent;
};

export type ReportNote = {
  req: ["report_note", { event_id: string; reason: string }];
  event: NostrEvent;
};

export type GetFilterlist = {
  req: ["get_filterlist", {}];
  event: NostrEvent;
};

export type CheckFilterlist = {
  req: ["check_filterlist", { pubkeys: string[] }];
  event: NostrEvent;
};

export type BroadcastReply = {
  req: ["broadcast_reply", { event: NostrEvent }];
  event: NostrEvent;
};

export type BroadcastEvents = {
  req: ["broadcast_events", { events: NostrEvent[]; relays: string[] }];
  event: NostrEvent;
};

export type TrustedUsers = {
  req: ["trusted_users", { limit?: number; extended_response?: boolean }];
  event: NostrEvent;
};

export type NoteMentions = {
  req: [
    "note_mentions",
    {
      event_id?: string;
      pubkey?: string;
      identifier?: string;
      limit?: number;
      offset?: number;
      user_pubkey?: string;
    },
  ];
  event: NostrEvent;
};

export type NoteMentionsCount = {
  req: ["note_mentions_count", { event_id: string }];
  event: NostrEvent;
};

export type GetMediaMetadata = {
  req: ["get_media_metadata", { urls: string[] }];
  event: NostrEvent;
};

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
  cacheRequest<R extends CacheRequest>(
    request: CacheRequest["req"],
  ): Observable<R["event"]> {
    return this.req({
      // @ts-expect-error
      cache: request,
    }).pipe(completeOnEose()) as unknown as Observable<R["event"]>;
  }

  // ===== EXPLORE METHODS =====

  /** Get legend counts for explore page */
  exploreLegendCounts(pubkey: string): Promise<ExploreLegendCounts["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["explore_legend_counts", { pubkey }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Explore content with various filters */
  explore(params: Explore["req"][1]): Promise<Explore["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["explore", params]).pipe(mapEventsToTimeline()),
    );
  }

  /** Get global trending content from last 24 hours */
  exploreGlobalTrending24h(
    limit = 20,
  ): Promise<ExploreGlobalTrending24h["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["explore_global_trending_24h", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get global most zapped content from last 4 hours */
  exploreGlobalMostZapped4h(
    limit = 20,
  ): Promise<ExploreGlobalMostZapped4h["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["explore_global_mostzapped_4h", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== SCORED CONTENT METHODS =====

  /** Get scored content */
  scored(params: Scored["req"][1]): Promise<Scored["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["scored", params]).pipe(mapEventsToTimeline()),
    );
  }

  /** Get scored users */
  scoredUsers(limit = 20): Promise<ScoredUsers["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["scored_users", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get scored users from last 24 hours */
  scoredUsers24h(limit = 20): Promise<ScoredUsers24h["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["scored_users_24h", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== RELAY METHODS =====

  /** Get default relays */
  getDefaultRelays(): Promise<GetDefaultRelays["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_default_relays", {}]).pipe(mapEventsToTimeline()),
    );
  }

  // ===== USER METHODS =====

  /** Get recommended users */
  getRecommendedUsers(limit = 20): Promise<GetRecommendedUsers["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_recommended_users", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get suggested users */
  getSuggestedUsers(limit = 20): Promise<GetSuggestedUsers["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_suggested_users", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Search for users by query */
  userSearch(query: string, limit = 10): Promise<UserSearch["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["user_search", { query, limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get trusted users */
  trustedUsers(
    limit = 500,
    extendedResponse = true,
  ): Promise<TrustedUsers["event"][]> {
    return lastValueFrom(
      this.cacheRequest([
        "trusted_users",
        { limit, extended_response: extendedResponse },
      ]).pipe(mapEventsToTimeline()),
    );
  }

  // ===== PROFILE METHODS =====

  /** Get user profile scored content */
  userProfileScoredContent(
    params: UserProfileScoredContent["req"][1],
  ): Promise<UserProfileScoredContent["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["user_profile_scored_content", params]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get user profile scored media thumbnails */
  userProfileScoredMediaThumbnails(
    params: UserProfileScoredMediaThumbnails["req"][1],
  ): Promise<UserProfileScoredMediaThumbnails["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["user_profile_scored_media_thumbnails", params]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== SEARCH METHODS =====

  /** Search content */
  search(params: Search["req"][1]): Promise<Search["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["search", params]).pipe(mapEventsToTimeline()),
    );
  }

  /** Advanced search */
  advancedSearch(
    params: AdvancedSearch["req"][1],
  ): Promise<AdvancedSearch["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["advanced_search", params]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== FEED METHODS =====

  /** Advanced feed */
  advancedFeed(
    params: AdvancedFeed["req"][1],
  ): Promise<AdvancedFeed["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["advanced_feed", params]).pipe(mapEventsToTimeline()),
    );
  }

  /** Feed directive */
  feedDirective(
    params: FeedDirective["req"][1],
  ): Promise<FeedDirective["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["feed_directive", params]).pipe(mapEventsToTimeline()),
    );
  }

  /** Feed directive v2 */
  feedDirective2(
    params: FeedDirective2["req"][1],
  ): Promise<FeedDirective2["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["feed_directive_2", params]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get advanced feeds */
  getAdvancedFeeds(): Promise<GetAdvancedFeeds["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_advanced_feeds", {}]).pipe(mapEventsToTimeline()),
    );
  }

  // ===== TRENDING METHODS =====

  /** Get trending hashtags */
  trendingHashtags(limit = 20): Promise<TrendingHashtags["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["trending_hashtags", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get trending hashtags from last 4 hours */
  trendingHashtags4h(limit = 20): Promise<TrendingHashtags4h["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["trending_hashtags_4h", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get trending hashtags from last 7 days */
  trendingHashtags7d(limit = 20): Promise<TrendingHashtags7d["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["trending_hashtags_7d", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get trending images */
  trendingImages(limit = 20): Promise<TrendingImages["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["trending_images", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get trending images from last 4 hours */
  trendingImages4h(limit = 20): Promise<TrendingImages4h["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["trending_images_4h", { limit }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== NOTIFICATION METHODS =====

  /** Get notifications */
  getNotifications(
    params: GetNotifications["req"][1],
  ): Promise<GetNotifications["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_notifications", params]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Set notifications as seen */
  setNotificationsSeen(
    pubkey: string,
    until: number,
  ): Promise<SetNotificationsSeen["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["set_notifications_seen", { pubkey, until }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Get notifications seen status */
  getNotificationsSeen(
    pubkey: string,
  ): Promise<GetNotificationsSeen["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_notifications_seen", { pubkey }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== RELAY METHODS =====

  /** Get relays */
  relays(): Promise<Relays["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["relays", {}]).pipe(mapEventsToTimeline()),
    );
  }

  // ===== REPORT METHODS =====

  /** Report user */
  reportUser(pubkey: string, reason: string): Promise<ReportUser["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["report_user", { pubkey, reason }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Report note */
  reportNote(eventId: string, reason: string): Promise<ReportNote["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["report_note", { event_id: eventId, reason }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== FILTERLIST METHODS =====

  /** Get filterlist */
  getFilterlist(): Promise<GetFilterlist["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_filterlist", {}]).pipe(mapEventsToTimeline()),
    );
  }

  /** Check filterlist */
  checkFilterlist(pubkeys: string[]): Promise<CheckFilterlist["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["check_filterlist", { pubkeys }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== BROADCAST METHODS =====

  /** Broadcast reply */
  broadcastReply(event: NostrEvent): Promise<BroadcastReply["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["broadcast_reply", { event }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  /** Broadcast events */
  broadcastEvents(
    events: NostrEvent[],
    relays: string[],
  ): Promise<BroadcastEvents["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["broadcast_events", { events, relays }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== MENTION METHODS =====

  /** Get note mentions */
  noteMentions(
    params: NoteMentions["req"][1],
  ): Promise<NoteMentions["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["note_mentions", params]).pipe(mapEventsToTimeline()),
    );
  }

  /** Get note mentions count */
  noteMentionsCount(eventId: string): Promise<NoteMentionsCount["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["note_mentions_count", { event_id: eventId }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }

  // ===== MEDIA METHODS =====

  /** Get media metadata */
  getMediaMetadata(urls: string[]): Promise<GetMediaMetadata["event"][]> {
    return lastValueFrom(
      this.cacheRequest(["get_media_metadata", { urls }]).pipe(
        mapEventsToTimeline(),
      ),
    );
  }
}
