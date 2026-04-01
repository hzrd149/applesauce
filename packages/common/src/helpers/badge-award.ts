import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { kinds, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";
import {
  AddressPointer,
  getAddressPointerFromATag,
  getProfilePointerFromPTag,
  ProfilePointer,
} from "applesauce-core/helpers/pointers";
import { isATag, isPTag, processTags } from "applesauce-core/helpers/tags";

/** Type guard for a valid badge award event */
export type BadgeAwardEvent = KnownEvent<typeof kinds.BadgeAward>;

const BadgeAwardDefinitionSymbol = Symbol.for("badge-award-definition");
const BadgeAwardRecipientsSymbol = Symbol.for("badge-award-recipients");

/**
 * Returns true if the event is a valid badge award (kind 8).
 * Validates kind, required `a` tag (definition pointer), and at least one `p` tag (recipient).
 */
export function isBadgeAwardEvent(event?: NostrEvent): event is BadgeAwardEvent {
  if (!event || event.kind !== kinds.BadgeAward) return false;
  if (!event.tags.find(isATag)) return false;
  if (!event.tags.find(isPTag)) return false;
  return true;
}

/** Returns the definition pointer referenced by a badge award's first `a` tag. */
export function getBadgeAwardPointer(event: BadgeAwardEvent): AddressPointer;
export function getBadgeAwardPointer(event?: NostrEvent): AddressPointer | undefined;
export function getBadgeAwardPointer(event?: NostrEvent): AddressPointer | undefined {
  if (!isBadgeAwardEvent(event)) return undefined;

  return getOrComputeCachedValue(event, BadgeAwardDefinitionSymbol, () => {
    const aTag = event.tags.find(isATag);
    return aTag ? (getAddressPointerFromATag(aTag) ?? undefined) : undefined;
  });
}

/** Returns every recipient pubkey listed in the badge award's `p` tags. */
export function getBadgeAwardRecipients(event: BadgeAwardEvent): ProfilePointer[];
export function getBadgeAwardRecipients(event?: NostrEvent): ProfilePointer[];
export function getBadgeAwardRecipients(event?: NostrEvent): ProfilePointer[] {
  if (!isBadgeAwardEvent(event)) return [];

  return getOrComputeCachedValue(event, BadgeAwardRecipientsSymbol, () =>
    processTags(event.tags, (t) => (isPTag(t) ? (getProfilePointerFromPTag(t) ?? undefined) : undefined)),
  );
}
