import { getOrComputeCachedValue, notifyEventUpdate } from "applesauce-core/helpers";
import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import { getTagValue } from "applesauce-core/helpers/event";
import { HiddenContentSigner } from "applesauce-core/helpers/hidden-content";
import {
  getHiddenTags,
  isHiddenTagsUnlocked,
  setHiddenTagsEncryptionMethod,
  unlockHiddenTags,
} from "applesauce-core/helpers/hidden-tags";

// NIP-85 Trusted Assertions Kinds
export const TRUSTED_PROVIDER_LIST_KIND = 10040;
export const USER_ASSERTION_KIND = 30382;

// Register NIP-85 kind 10040 as using NIP-44 hidden tags
setHiddenTagsEncryptionMethod(TRUSTED_PROVIDER_LIST_KIND, "nip44");

// Event types
export type TrustedProviderListEvent = KnownEvent<typeof TRUSTED_PROVIDER_LIST_KIND>;
export type UserAssertionEvent = KnownEvent<typeof USER_ASSERTION_KIND>;

/** A parsed trusted provider declaration from a kind 10040 event */
export type TrustedProvider = {
  /** The assertion kind (e.g. 30382) */
  kind: number;
  /** The assertion tag name (e.g. "rank") */
  tag: string;
  /** The service provider's pubkey */
  servicePubkey: string;
  /** Optional relay hint where the provider publishes assertion events */
  relay?: string;
};

/** Unlocked trusted provider list type */
export type UnlockedTrustedProviderList = {
  [TrustedProvidersHiddenSymbol]: TrustedProvider[];
};

// Caching symbols
export const TrustedProvidersPublicSymbol = Symbol.for("trusted-providers-public");
export const TrustedProvidersHiddenSymbol = Symbol.for("trusted-providers-hidden");

// ─── Kind 10040 Helpers ──────────────────────────────────────────────────────

/** Validates that an event is a valid trusted provider list (kind 10040) */
export function isValidTrustedProviderList(event: NostrEvent): event is TrustedProviderListEvent {
  return event.kind === TRUSTED_PROVIDER_LIST_KIND;
}

/**
 * Parses a single provider tag into a {@link TrustedProvider}
 * Tag format: ["<kind>:<tag>", "<servicePubkey>", "<relayHint?>"]
 */
export function parseProviderTag(tag: string[]): TrustedProvider | undefined {
  if (tag.length < 2) return undefined;

  const [kindTag, servicePubkey, relay] = tag;
  if (!kindTag || !servicePubkey) return undefined;

  const colonIndex = kindTag.indexOf(":");
  if (colonIndex === -1) return undefined;

  const kind = parseInt(kindTag.slice(0, colonIndex), 10);
  const assertionTag = kindTag.slice(colonIndex + 1);

  if (isNaN(kind) || !assertionTag) return undefined;

  return { kind, tag: assertionTag, servicePubkey, relay: relay || undefined };
}

/** Returns all public trusted providers from a kind 10040 event */
export function getPublicProviders(event: NostrEvent): TrustedProvider[] {
  return getOrComputeCachedValue(event, TrustedProvidersPublicSymbol, () =>
    event.tags.map(parseProviderTag).filter((p): p is TrustedProvider => p !== undefined),
  );
}

/** Returns hidden trusted providers if the event is unlocked */
export function getHiddenProviders<T extends NostrEvent & UnlockedTrustedProviderList>(event: T): TrustedProvider[];
export function getHiddenProviders<T extends NostrEvent>(event: T): TrustedProvider[] | undefined;
export function getHiddenProviders<T extends NostrEvent>(event: T): TrustedProvider[] | undefined {
  if (TrustedProvidersHiddenSymbol in event) return event[TrustedProvidersHiddenSymbol] as TrustedProvider[];

  const tags = getHiddenTags(event);
  if (!tags) return undefined;

  const providers = tags.map(parseProviderTag).filter((p): p is TrustedProvider => p !== undefined);
  Reflect.set(event, TrustedProvidersHiddenSymbol, providers);
  return providers;
}

/** Checks if the hidden providers are unlocked */
export function isHiddenProvidersUnlocked<T extends NostrEvent>(event: T): event is T & UnlockedTrustedProviderList {
  return TrustedProvidersHiddenSymbol in event || isHiddenTagsUnlocked(event);
}

/** Unlocks the hidden providers in a trusted provider list event */
export async function unlockHiddenProviders(
  event: NostrEvent,
  signer: HiddenContentSigner,
): Promise<TrustedProvider[]> {
  if (TrustedProvidersHiddenSymbol in event) return event[TrustedProvidersHiddenSymbol] as TrustedProvider[];

  await unlockHiddenTags(event, signer);

  const providers = getHiddenProviders(event);
  if (!providers) throw new Error("Failed to unlock hidden providers");

  notifyEventUpdate(event);
  return providers;
}

/** Returns all providers (public + hidden if unlocked) for a given kind and tag */
export function getAllProviders(event: NostrEvent): TrustedProvider[] {
  const pub = getPublicProviders(event);
  const hidden = getHiddenProviders(event);
  return hidden ? [...pub, ...hidden] : pub;
}

/** Returns all providers for a specific assertion kind and tag */
export function getProvidersForAssertion(event: NostrEvent, kind: number, tag: string): TrustedProvider[] {
  return getAllProviders(event).filter((p) => p.kind === kind && p.tag === tag);
}

// ─── Kind 30382 User Assertion Helpers ──────────────────────────────────────

/** Validates that an event is a valid user assertion (kind 30382) */
export function isValidUserAssertion(event: NostrEvent): event is UserAssertionEvent {
  if (event.kind !== USER_ASSERTION_KIND) return false;
  return !!getTagValue(event, "d");
}

/** Returns the subject pubkey from a user assertion event (from the `d` tag) */
export function getAssertionSubject(event: NostrEvent): string | undefined {
  return getTagValue(event, "d");
}

/** Parses an integer tag value, returns undefined if absent or not a number */
function getIntTag(event: NostrEvent, name: string): number | undefined {
  const value = getTagValue(event, name);
  if (value === undefined) return undefined;
  const n = parseInt(value, 10);
  return isNaN(n) ? undefined : n;
}

/** Returns the user rank (0–100) */
export function getAssertionRank(event: NostrEvent): number | undefined {
  return getIntTag(event, "rank");
}

/** Returns the follower count */
export function getAssertionFollowerCount(event: NostrEvent): number | undefined {
  return getIntTag(event, "followers");
}

/** Returns the unix timestamp of the user's first post */
export function getAssertionFirstCreatedAt(event: NostrEvent): number | undefined {
  return getIntTag(event, "first_created_at");
}

/** Returns the total post count */
export function getAssertionPostCount(event: NostrEvent): number | undefined {
  return getIntTag(event, "post_cnt");
}

/** Returns the total reply count */
export function getAssertionReplyCount(event: NostrEvent): number | undefined {
  return getIntTag(event, "reply_cnt");
}

/** Returns the total reactions count */
export function getAssertionReactionsCount(event: NostrEvent): number | undefined {
  return getIntTag(event, "reactions_cnt");
}

/** Returns the total zap amount received (in sats) */
export function getAssertionZapAmountReceived(event: NostrEvent): number | undefined {
  return getIntTag(event, "zap_amt_recd");
}

/** Returns the total zap amount sent (in sats) */
export function getAssertionZapAmountSent(event: NostrEvent): number | undefined {
  return getIntTag(event, "zap_amt_sent");
}

/** Returns the total number of zaps received */
export function getAssertionZapCountReceived(event: NostrEvent): number | undefined {
  return getIntTag(event, "zap_cnt_recd");
}

/** Returns the total number of zaps sent */
export function getAssertionZapCountSent(event: NostrEvent): number | undefined {
  return getIntTag(event, "zap_cnt_sent");
}

/** Returns the average zap amount received per day (in sats) */
export function getAssertionZapAvgAmountDayReceived(event: NostrEvent): number | undefined {
  return getIntTag(event, "zap_avg_amt_day_recd");
}

/** Returns the average zap amount sent per day (in sats) */
export function getAssertionZapAvgAmountDaySent(event: NostrEvent): number | undefined {
  return getIntTag(event, "zap_avg_amt_day_sent");
}

/** Returns the number of reports received */
export function getAssertionReportsReceived(event: NostrEvent): number | undefined {
  return getIntTag(event, "reports_cnt_recd");
}

/** Returns the number of reports sent */
export function getAssertionReportsSent(event: NostrEvent): number | undefined {
  return getIntTag(event, "reports_cnt_sent");
}

/** Returns the user's common topics (from `t` tags) */
export function getAssertionTopics(event: NostrEvent): string[] {
  return event.tags.filter((t) => t[0] === "t" && t[1]).map((t) => t[1]);
}

/** Returns the hour (UTC, 0–24) at which the user generally becomes active */
export function getAssertionActivityHoursStart(event: NostrEvent): number | undefined {
  return getIntTag(event, "active_hours_start");
}

/** Returns the hour (UTC, 0–24) at which the user generally becomes inactive */
export function getAssertionActivityHoursEnd(event: NostrEvent): number | undefined {
  return getIntTag(event, "active_hours_end");
}
