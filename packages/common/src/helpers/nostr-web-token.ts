import { base64urlnopad, utf8 } from "@scure/base";
import { getOrComputeCachedValue } from "applesauce-core/helpers/cache";
import { getTagValue, isEvent, KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

export const NOSTR_WEB_TOKEN_KIND = 27519;

export type NostrWebTokenEvent = KnownEvent<typeof NOSTR_WEB_TOKEN_KIND>;

export type NostrWebTokenClaims = {
  /** Issuer claim, defaults to the signing pubkey when omitted */
  issuer: string;
  /** Subject claim, defaults to the signing pubkey when omitted */
  subject: string;
  /** Audience claims */
  audiences: string[];
  /** Issued-at timestamp, defaults to the event created_at when omitted */
  issuedAt: number;
  /** Expiration timestamp */
  expiration?: number;
  /** Not-before timestamp */
  notBefore?: number;
  /** Additional application-defined claims */
  claims: Record<string, string[]>;
};

export const NostrWebTokenClaimsSymbol = Symbol.for("nostr-web-token-claims");

const singletonClaims = new Set(["iss", "sub", "iat", "exp", "nbf"]);
const registeredClaims = new Set(["iss", "sub", "aud", "iat", "exp", "nbf"]);

function parseTimestamp(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  return Number.parseInt(value, 10);
}

function isValidTimestamp(value: string | undefined): boolean {
  return parseTimestamp(value) !== undefined;
}

/** Parses all registered and custom claims from a Nostr Web Token event. */
export function parseNostrWebTokenClaims(event: NostrWebTokenEvent): NostrWebTokenClaims;
export function parseNostrWebTokenClaims(event: NostrEvent): NostrWebTokenClaims | undefined;
export function parseNostrWebTokenClaims(event: NostrEvent): NostrWebTokenClaims | undefined {
  if (event.kind !== NOSTR_WEB_TOKEN_KIND) return undefined;

  return getOrComputeCachedValue(event, NostrWebTokenClaimsSymbol, () => {
    const claims: Record<string, string[]> = {};
    const audiences: string[] = [];

    for (const tag of event.tags) {
      const [name, value] = tag;
      if (value === undefined) continue;

      if (name === "aud") audiences.push(value);
      else if (!registeredClaims.has(name)) claims[name] = claims[name] ? [...claims[name], value] : [value];
    }

    return {
      issuer: getTagValue(event, "iss") ?? event.pubkey,
      subject: getTagValue(event, "sub") ?? event.pubkey,
      audiences,
      issuedAt: parseTimestamp(getTagValue(event, "iat")) ?? event.created_at,
      expiration: parseTimestamp(getTagValue(event, "exp")),
      notBefore: parseTimestamp(getTagValue(event, "nbf")),
      claims,
    };
  });
}

/** Gets the issuer claim, or the signing pubkey when absent. */
export function getNostrWebTokenIssuer(event: NostrWebTokenEvent): string;
export function getNostrWebTokenIssuer(event: NostrEvent): string | undefined;
export function getNostrWebTokenIssuer(event: NostrEvent): string | undefined {
  return parseNostrWebTokenClaims(event)?.issuer;
}

/** Gets the subject claim, or the signing pubkey when absent. */
export function getNostrWebTokenSubject(event: NostrWebTokenEvent): string;
export function getNostrWebTokenSubject(event: NostrEvent): string | undefined;
export function getNostrWebTokenSubject(event: NostrEvent): string | undefined {
  return parseNostrWebTokenClaims(event)?.subject;
}

/** Gets all audience claims. */
export function getNostrWebTokenAudiences(event: NostrWebTokenEvent): string[];
export function getNostrWebTokenAudiences(event: NostrEvent): string[] | undefined;
export function getNostrWebTokenAudiences(event: NostrEvent): string[] | undefined {
  return parseNostrWebTokenClaims(event)?.audiences;
}

/** Gets the issued-at claim, or the event created_at when absent. */
export function getNostrWebTokenIssuedAt(event: NostrWebTokenEvent): number;
export function getNostrWebTokenIssuedAt(event: NostrEvent): number | undefined;
export function getNostrWebTokenIssuedAt(event: NostrEvent): number | undefined {
  return parseNostrWebTokenClaims(event)?.issuedAt;
}

/** Gets the expiration claim. */
export function getNostrWebTokenExpiration(event: NostrEvent): number | undefined {
  return parseNostrWebTokenClaims(event)?.expiration;
}

/** Gets the not-before claim. */
export function getNostrWebTokenNotBefore(event: NostrEvent): number | undefined {
  return parseNostrWebTokenClaims(event)?.notBefore;
}

/** Checks if an event is structurally a valid Nostr Web Token. Does not verify the event signature. */
export function isValidNostrWebToken(event?: NostrEvent): event is NostrWebTokenEvent {
  if (!event || event.kind !== NOSTR_WEB_TOKEN_KIND) return false;
  if (!isEvent(event)) return false;

  for (const name of registeredClaims) {
    const tags = event.tags.filter((tag) => tag[0] === name);
    if (tags.some((tag) => tag[1] === undefined)) return false;
    if (singletonClaims.has(name) && tags.length > 1) return false;
  }

  for (const name of ["iat", "exp", "nbf"]) {
    const tag = event.tags.find((t) => t[0] === name);
    if (tag && !isValidTimestamp(tag[1])) return false;
  }

  return true;
}

/** Checks the exp and nbf claims against a timestamp. */
export function isNostrWebTokenActive(event: NostrEvent, now = Math.floor(Date.now() / 1000), clockSkew = 60): boolean {
  if (!isValidNostrWebToken(event)) return false;

  const claims = parseNostrWebTokenClaims(event);
  if (!claims) return false;

  if (claims.expiration !== undefined && now - clockSkew >= claims.expiration) return false;
  if (claims.notBefore !== undefined && now + clockSkew < claims.notBefore) return false;

  return true;
}

/** Checks if a token contains a matching audience claim. */
export function hasNostrWebTokenAudience(event: NostrEvent, audience: string): boolean {
  return parseNostrWebTokenClaims(event)?.audiences.includes(audience) ?? false;
}

/** Encodes a Nostr Web Token event for HTTP Authorization transport. */
export function encodeNostrWebToken(event: NostrEvent): string {
  return base64urlnopad.encode(utf8.decode(JSON.stringify(event)));
}

/** Decodes a Nostr Web Token from Base64URL transport encoding. */
export function decodeNostrWebToken(token: string): NostrEvent | undefined {
  try {
    const event = JSON.parse(utf8.encode(base64urlnopad.decode(token)));
    return isEvent(event) ? event : undefined;
  } catch {
    return undefined;
  }
}

/** Creates an HTTP Authorization header value for a Nostr Web Token event. */
export function createNostrWebTokenAuthorizationHeader(event: NostrEvent): string {
  return `Nostr ${encodeNostrWebToken(event)}`;
}

/** Parses an HTTP Authorization header value containing a Nostr Web Token. */
export function parseNostrWebTokenAuthorizationHeader(header: string | null | undefined): NostrEvent | undefined {
  const match = header?.match(/^Nostr\s+(.+)$/i);
  if (!match) return undefined;
  return decodeNostrWebToken(match[1]);
}
