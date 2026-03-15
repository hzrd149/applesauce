import { NostrEvent } from "applesauce-core/helpers";
import { hasHiddenContent } from "applesauce-core/helpers/hidden-content";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import { mergeRelaySets } from "applesauce-core/helpers/relays";
import { watchEventUpdates } from "applesauce-core/observable";
import { combineLatest, map, of, switchMap } from "rxjs";
import {
  getAssertionActivityHoursEnd,
  getAssertionActivityHoursStart,
  getAssertionFirstCreatedAt,
  getAssertionFollowerCount,
  getAssertionPostCount,
  getAssertionReactionsCount,
  getAssertionRank,
  getAssertionReplyCount,
  getAssertionReportsReceived,
  getAssertionReportsSent,
  getAssertionSubject,
  getAssertionTopics,
  getAssertionZapAmountReceived,
  getAssertionZapAmountSent,
  getAssertionZapAvgAmountDayReceived,
  getAssertionZapAvgAmountDaySent,
  getAssertionZapCountReceived,
  getAssertionZapCountSent,
  getAllProviders,
  getHiddenProviders,
  getPublicProviders,
  isHiddenProvidersUnlocked,
  isValidTrustedProviderList,
  isValidUserAssertion,
  TrustedProvider,
  TrustedProviderListEvent,
  unlockHiddenProviders,
  USER_ASSERTION_KIND,
  UserAssertionEvent,
} from "../helpers/trusted-assertions.js";
import { castEventStream } from "../observable/cast-stream.js";
import { CastRefEventStore, castPubkey, EventCast, PubkeyCast } from "./cast.js";
import { castUser } from "./user.js";

// ─── AssertionProvider ───────────────────────────────────────────────────────

/** A cast for a service provider pubkey that publishes NIP-85 assertion events */
export class AssertionProvider extends PubkeyCast {
  /** @internal Per-class singleton cache used by castPubkey */
  static cache: Map<string, AssertionProvider> = new Map();

  /** Relay hints declared for this provider in the trusted provider list */
  get providerRelays(): string[] {
    return this.pointer.relays ?? [];
  }

  /** Returns the relays to use when querying this provider's assertion events */
  get relays$() {
    return castUser(this.pubkey, this.store).outboxes$.pipe(
      map((outboxes) => mergeRelaySets(this.providerRelays, outboxes)),
    );
  }

  /**
   * Returns an observable of the assertion event published by this provider
   * about the given user pubkey. Uses $$ref for caching.
   */
  getUserAssertion(pubkey: string) {
    return this.$$ref(`user-assertion:${pubkey}`, (store) =>
      this.relays$.pipe(
        switchMap((relays) =>
          store
            .addressable({
              kind: USER_ASSERTION_KIND,
              pubkey: this.pubkey,
              identifier: pubkey,
              relays: relays.length > 0 ? relays : undefined,
            })
            .pipe(castEventStream(UserAssertion, store)),
        ),
      ),
    );
  }

  // ── Convenience metric observables ──────────────────────────────────────

  getUserRank(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.rank));
  }

  getUserFollowerCount(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.followerCount));
  }

  getUserPostCount(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.postCount));
  }

  getUserReplyCount(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.replyCount));
  }

  getUserReactionsCount(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.reactionsCount));
  }

  getUserZapsReceived(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.zapsReceived));
  }

  getUserZapsSent(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.zapsSent));
  }

  getUserReportsReceived(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.reportsReceived));
  }

  getUserReportsSent(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.reportsSent));
  }

  getUserTopics(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.topics));
  }

  getUserActivityWindow(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.activityWindow));
  }

  getUserFirstPostTime(pubkey: string) {
    return this.getUserAssertion(pubkey).pipe(map((a) => a?.firstPostTime));
  }
}

// ─── Helper to map TrustedProvider entries to AssertionProvider instances ───

function toAssertionProviders(providers: TrustedProvider[], store: CastRefEventStore): AssertionProvider[] {
  return providers.map((p) =>
    castPubkey({ pubkey: p.servicePubkey, relays: p.relay ? [p.relay] : undefined }, AssertionProvider, store),
  );
}

// ─── TrustedProviderList ─────────────────────────────────────────────────────

/** Cast a kind 10040 event to a TrustedProviderList */
export class TrustedProviderList extends EventCast<TrustedProviderListEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidTrustedProviderList(event)) throw new Error("Invalid trusted provider list");
    super(event, store);
  }

  // ── Raw provider accessors ────────────────────────────────────────────────

  /** All publicly declared providers (from tags) */
  get publicProviders(): TrustedProvider[] {
    return getPublicProviders(this.event);
  }

  /** Hidden providers if the event has been unlocked, otherwise undefined */
  get hiddenProviders(): TrustedProvider[] | undefined {
    return getHiddenProviders(this.event);
  }

  /** Observable that updates when hidden providers become available (after unlock) */
  get hiddenProviders$() {
    return this.$$ref("hiddenProviders$", (store) =>
      of(this.event).pipe(
        watchEventUpdates(store),
        map((event) => (event ? getHiddenProviders(event) : undefined)),
      ),
    );
  }

  /** Whether this list has an encrypted hidden providers section */
  get hasHidden(): boolean {
    return hasHiddenContent(this.event);
  }

  /** Whether the hidden providers have been unlocked */
  get unlocked(): boolean {
    return isHiddenProvidersUnlocked(this.event);
  }

  /** Decrypt and unlock the hidden providers */
  unlock(signer: HiddenContentSigner) {
    return unlockHiddenProviders(this.event, signer);
  }

  // ── Internal: combine public + hidden providers reactively ───────────────

  #allProviders$() {
    return combineLatest([of(this.publicProviders), this.hiddenProviders$]).pipe(
      map(([pub, hidden]) => [...pub, ...(hidden ?? [])]),
    );
  }

  #providersFor$(kind: number, tag: string) {
    return this.$$ref(`providers:${kind}:${tag}`, (store) =>
      this.#allProviders$().pipe(
        map((all) =>
          toAssertionProviders(
            all.filter((p) => p.kind === kind && p.tag === tag),
            store,
          ),
        ),
      ),
    );
  }

  // ── Kind 30382 (User assertion) provider observables ─────────────────────

  /** Providers trusted for user rank (0–100) */
  get userRank$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "rank");
  }

  /** Providers trusted for user follower count */
  get userFollowers$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "followers");
  }

  /** Providers trusted for user first post timestamp */
  get userFirstCreatedAt$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "first_created_at");
  }

  /** Providers trusted for user post count */
  get userPostCount$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "post_cnt");
  }

  /** Providers trusted for user reply count */
  get userReplyCount$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "reply_cnt");
  }

  /** Providers trusted for user reactions count */
  get userReactionsCount$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "reactions_cnt");
  }

  /** Providers trusted for zap amount received */
  get userZapAmountReceived$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "zap_amt_recd");
  }

  /** Providers trusted for zap amount sent */
  get userZapAmountSent$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "zap_amt_sent");
  }

  /** Providers trusted for zap count received */
  get userZapCountReceived$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "zap_cnt_recd");
  }

  /** Providers trusted for zap count sent */
  get userZapCountSent$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "zap_cnt_sent");
  }

  /** Providers trusted for average daily zap amount received */
  get userZapAvgAmountDayReceived$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "zap_avg_amt_day_recd");
  }

  /** Providers trusted for average daily zap amount sent */
  get userZapAvgAmountDaySent$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "zap_avg_amt_day_sent");
  }

  /** Providers trusted for reports received count */
  get userReportsReceived$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "reports_cnt_recd");
  }

  /** Providers trusted for reports sent count */
  get userReportsSent$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "reports_cnt_sent");
  }

  /** Providers trusted for user common topics */
  get userTopics$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "t");
  }

  /** Providers trusted for user activity hours start */
  get userActivityHoursStart$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "active_hours_start");
  }

  /** Providers trusted for user activity hours end */
  get userActivityHoursEnd$() {
    return this.#providersFor$(USER_ASSERTION_KIND, "active_hours_end");
  }
}

// ─── UserAssertion ───────────────────────────────────────────────────────────

/** Cast a kind 30382 event to a UserAssertion */
export class UserAssertion extends EventCast<UserAssertionEvent> {
  constructor(event: NostrEvent, store: CastRefEventStore) {
    if (!isValidUserAssertion(event)) throw new Error("Invalid user assertion");
    super(event, store);
  }

  /** The pubkey of the user being evaluated */
  get subjectPubkey(): string {
    return getAssertionSubject(this.event)!;
  }

  /** Observable of the {@link User} cast for the subject of this assertion */
  get subject$() {
    return this.$$ref("subject$", () => of(castUser(this.subjectPubkey, this.store)));
  }

  /** The {@link AssertionProvider} that published this assertion */
  get provider(): AssertionProvider {
    return castPubkey(this.event.pubkey, AssertionProvider, this.store);
  }

  // ── Assertion metrics ────────────────────────────────────────────────────

  /** User rank score (0–100) */
  get rank() {
    return getAssertionRank(this.event);
  }

  /** Follower count */
  get followerCount() {
    return getAssertionFollowerCount(this.event);
  }

  /** Unix timestamp of the user's first post */
  get firstCreatedAt() {
    return getAssertionFirstCreatedAt(this.event);
  }

  /** Total post count */
  get postCount() {
    return getAssertionPostCount(this.event);
  }

  /** Total reply count */
  get replyCount() {
    return getAssertionReplyCount(this.event);
  }

  /** Total reactions count */
  get reactionsCount() {
    return getAssertionReactionsCount(this.event);
  }

  /** Zap statistics for zaps received by this user */
  get zapsReceived() {
    return {
      count: getAssertionZapCountReceived(this.event),
      amount: getAssertionZapAmountReceived(this.event),
      avgPerDay: getAssertionZapAvgAmountDayReceived(this.event),
    };
  }

  /** Zap statistics for zaps sent by this user */
  get zapsSent() {
    return {
      count: getAssertionZapCountSent(this.event),
      amount: getAssertionZapAmountSent(this.event),
      avgPerDay: getAssertionZapAvgAmountDaySent(this.event),
    };
  }

  /** Number of reports this user has received */
  get reportsReceived() {
    return getAssertionReportsReceived(this.event);
  }

  /** Number of reports this user has sent */
  get reportsSent() {
    return getAssertionReportsSent(this.event);
  }

  /** Common topics associated with this user */
  get topics() {
    return getAssertionTopics(this.event);
  }

  /** UTC hour range during which this user is generally active */
  get activityWindow() {
    return {
      start: getAssertionActivityHoursStart(this.event),
      end: getAssertionActivityHoursEnd(this.event),
    };
  }

  /** Date of the user's first post, or undefined if not provided */
  get firstPostTime(): Date | undefined {
    const ts = getAssertionFirstCreatedAt(this.event);
    return ts !== undefined ? new Date(ts * 1000) : undefined;
  }
}

// ─── castTrustedProviders helper ─────────────────────────────────────────────

/**
 * Convenience function to get all AssertionProvider instances for a specific
 * assertion type directly from a provider list event.
 */
export function castTrustedProviders(
  event: NostrEvent,
  kind: number,
  tag: string,
  store: CastRefEventStore,
): AssertionProvider[] {
  return toAssertionProviders(
    getAllProviders(event).filter((p) => p.kind === kind && p.tag === tag),
    store,
  );
}
