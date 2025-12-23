import { getOrComputeCachedValue, getTagValue, isHex, KnownEvent, safeParse } from "applesauce-core/helpers";
import { NostrEvent, getReplaceableIdentifier } from "applesauce-core/helpers/event";

// NIP-87 Cashu Mint Information Event Kind
export const CASHU_MINT_INFO_KIND = 38172;

// Type definitions
export type CashuMintInfoEvent = KnownEvent<typeof CASHU_MINT_INFO_KIND>;

// Network types
export type NetworkType = "mainnet" | "testnet" | "signet" | "regtest";

// Symbols for caching computed values
export const CashuMintPubkeySymbol = Symbol.for("cashu-mint-pubkey");
export const CashuMintURLSymbol = Symbol.for("cashu-mint-url");
export const CashuMintNutsSymbol = Symbol.for("cashu-mint-nuts");
export const CashuMintNetworkSymbol = Symbol.for("cashu-mint-network");

// ============================================================================
// Cashu Mint Information Event (kind:38172) Helpers
// ============================================================================

/**
 * Returns the mint's pubkey from a kind:38172 cashu mint info event
 * This is found in the `d` tag and is the pubkey from the mint's `/v1/info` endpoint
 */
export function getCashuMintPubkey(event: NostrEvent): string | undefined {
  return getOrComputeCachedValue(event, CashuMintPubkeySymbol, () => {
    const identifier = getReplaceableIdentifier(event);
    // Only return hex pubkeys
    if (!isHex(identifier)) return undefined;
    return identifier || undefined;
  });
}

/**
 * Returns the mint URL from a kind:38172 cashu mint info event
 * This is the URL to the cashu mint (from the `u` tag)
 */
export function getCashuMintURL(event: CashuMintInfoEvent): string;
export function getCashuMintURL(event: NostrEvent): string | undefined;
export function getCashuMintURL(event: NostrEvent): string | undefined {
  return getOrComputeCachedValue(event, CashuMintURLSymbol, () => {
    const url = getTagValue(event, "u");
    return url && URL.canParse(url) ? url : undefined;
  });
}

/**
 * Returns the supported nuts from a kind:38172 cashu mint info event
 * This is a comma-separated list of nut numbers (e.g., "1,2,3,4,5,6,7")
 */
export function getCashuMintNuts(event: NostrEvent): number[] {
  return getOrComputeCachedValue(event, CashuMintNutsSymbol, () => {
    const nutsStr = getTagValue(event, "nuts");
    if (!nutsStr) return [];
    return nutsStr
      .split(",")
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => !isNaN(n));
  });
}

/**
 * Returns the network type from a kind:38172 cashu mint info event
 * Should be one of: mainnet, testnet, signet, or regtest
 */
export function getCashuMintNetwork(event: NostrEvent): NetworkType | undefined {
  return getOrComputeCachedValue(event, CashuMintNetworkSymbol, () => {
    const network = getTagValue(event, "n");
    if (!network) return undefined;
    const validNetworks: NetworkType[] = ["mainnet", "testnet", "signet", "regtest"];
    return validNetworks.includes(network as NetworkType) ? (network as NetworkType) : undefined;
  });
}

/**
 * Returns the optional metadata content from a kind:38172 cashu mint info event
 * This is a kind:0-style metadata JSON object, useful when the pubkey is not a normal user
 */
export function getCashuMintMetadata(event: NostrEvent): Record<string, any> | undefined {
  if (!event.content) return undefined;
  return safeParse(event.content);
}

/**
 * Validates that an event is a proper kind:38172 cashu mint info event
 * Checks that the event is kind 38172 and has the required `d` and `u` tags
 */
export function isValidCashuMintInfo(event?: NostrEvent): event is CashuMintInfoEvent {
  if (!event) return false;
  if (event.kind !== CASHU_MINT_INFO_KIND) return false;
  const url = getCashuMintURL(event);
  return url !== undefined;
}
