import { getOrComputeCachedValue } from "./cache.js";
import { KnownEvent, NostrEvent, kinds } from "./event.js";
import { safeParse } from "./json.js";
import { npubEncode } from "./pointers.js";

export const ProfileContentSymbol = Symbol.for("profile-content");

export type ProfileContent = {
  /** Nickname or full name of the user */
  name?: string;
  /** @deprecated use name instead */
  username?: string;
  /** An alternative, bigger name with richer characters than `name`. `name` should always be set regardless of the presence of `display_name`. */
  display_name?: string;
  /** @deprecated use display_name instead */
  displayName?: string;
  /** Short bio or description of the user */
  about?: string;
  /** @deprecated use picture instead */
  image?: string;
  /** URL of the profile picture image */
  picture?: string;
  /** URL to a wide (~1024x768) picture to be optionally displayed in the background of a profile screen */
  banner?: string;
  /** A web URL related in any way to the event author */
  website?: string;
  /** A LNURL-based Lightning address in the format `lnurlp://…` */
  lud06?: string;
  /** Lightning address in the format `user@domain.com` (LUD-16 format) */
  lud16?: string;
  /** DNS-based verification identifier in the format `_@domain.com` or `user@domain.com` */
  nip05?: string;
  /** Boolean to clarify that the content is entirely or partially the result of automation, such as with chatbots or newsfeeds */
  bot?: boolean;
  /** Object representing the author's birth date. Each field may be omitted. */
  birthday?: {
    /** Birth year */
    year?: number;
    /** Birth month (1-12) */
    month?: number;
    /** Birth day (1-31) */
    day?: number;
  };
  /** An array of strings representing the author's preferred languages (in order of preference), each in IETF BCP 47 format (e.g., ["en", "ja"], ["es-AR", "en-US"]). The first element is the primary language. */
  languages?: string[];
};

/** Type for validated profile events */
export type ProfileEvent = KnownEvent<kinds.Metadata>;

/** Returns the parsed profile content for a kind 0 event */
export function getProfileContent(event: ProfileEvent): ProfileContent;
export function getProfileContent(event: NostrEvent): ProfileContent | undefined;
export function getProfileContent(event: NostrEvent): ProfileContent | undefined {
  return getOrComputeCachedValue(event, ProfileContentSymbol, () => {
    const profile = safeParse<ProfileContent>(event.content);
    if (!profile) return undefined;

    // ensure nip05 is a string
    if (profile.nip05 && typeof profile.nip05 !== "string") profile.nip05 = String(profile.nip05);

    // add missing protocol to website
    if (profile.website && profile.website?.length > 0 && profile.website?.startsWith("http") === false) {
      profile.website = "https://" + profile.website;
    }

    return profile;
  });
}

/** Checks if the content of the kind 0 event is valid JSON */
export function isValidProfile(profile?: NostrEvent): profile is ProfileEvent {
  if (!profile) return false;
  if (profile.kind !== kinds.Metadata && profile.kind !== kinds.Handlerinformation) return false;

  // Check if the profile content is valid
  if (!getProfileContent(profile)) return false;

  return true;
}

/** Gets the profile picture from a nostr event or profile content with fallback */
export function getProfilePicture(metadata: ProfileContent | NostrEvent | undefined): string | undefined;
export function getProfilePicture(metadata: ProfileContent | NostrEvent | undefined, fallback: string): string;
export function getProfilePicture(
  metadata: ProfileContent | NostrEvent | undefined,
  fallback?: string,
): string | undefined;
export function getProfilePicture(
  metadata: ProfileContent | NostrEvent | undefined,
  fallback?: string,
): string | undefined {
  if (!metadata) return fallback;

  // Get the metadata from the nostr event
  if ("pubkey" in metadata && "id" in metadata && "sig" in metadata) {
    if (isValidProfile(metadata)) metadata = getProfileContent(metadata);
    else metadata = undefined;
  }

  // Return the display name or fallback
  return (metadata?.picture || metadata?.image || fallback)?.trim();
}

/** Gets the display name from a profile with fallback */
export function getDisplayName(metadata: NostrEvent, fallback?: string): string;
export function getDisplayName(metadata: undefined): undefined;
export function getDisplayName(metadata: ProfileContent | undefined): string | undefined;
export function getDisplayName(metadata: ProfileContent | NostrEvent | undefined, fallback: string): string;
export function getDisplayName(
  metadata: ProfileContent | NostrEvent | undefined,
  fallback?: string,
): string | undefined;
export function getDisplayName(
  metadata: ProfileContent | NostrEvent | undefined,
  fallback?: string,
): string | undefined {
  if (!metadata) return fallback;

  // Get the metadata from the nostr event
  if ("pubkey" in metadata && "id" in metadata && "sig" in metadata) {
    // Set the fallback to the npub if not set
    if (!fallback) {
      const npub = npubEncode(metadata.pubkey);
      fallback = npub.slice(0, 5 + 4) + "…" + npub.slice(-4);
    }

    // Get the profile content
    if (isValidProfile(metadata)) metadata = getProfileContent(metadata);
    else metadata = undefined;
  }

  // Return the display name or fallback
  return (metadata?.display_name || metadata?.displayName || metadata?.name || fallback)?.trim();
}
