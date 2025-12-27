export type ExternalIdentifiers = {
  // URL (web)
  web: string;
  // hashtag
  "#": `#${string}`;
  // geohash
  geo: `geo:${string}`;
  // book
  isbn: `isbn:${string}`;
  // podcast
  "podcast:guid": `podcast:guid:${string}`;
  // podcast item
  "podcast:item:guid": `podcast:item:guid:${string}`;
  // podcast publisher
  "podcast:publisher:guid": `podcast:publisher:guid:${string}`;
  // movie
  isan: `isan:${string}`;
  // paper
  doi: `doi:${string}`;
  // blockchain - bitcoin
  "bitcoin:tx": `bitcoin:tx:${string}`;
  "bitcoin:address": `bitcoin:address:${string}`;
  // blockchain - ethereum
  "ethereum:tx": `ethereum:${string}:tx:${string}`; // ethereum:<chainId>:tx:<txHash>
  "ethereum:address": `ethereum:${string}:address:${string}`; // ethereum:<chainId>:address:<address>
  // blockchain - other chains (solana, etc.)
  // Format: <blockchain>:tx:<txid> or <blockchain>:address:<address>
  // We'll use a generic pattern that matches any blockchain
  [key: `${string}:tx`]: `${string}:tx:${string}`;
  [key: `${string}:address`]: `${string}:address:${string}`;
};

export type ExternalPointer<Prefix extends keyof ExternalIdentifiers> = {
  kind: Prefix;
  identifier: ExternalIdentifiers[Prefix];
};

export type ParseResult = {
  [P in keyof ExternalIdentifiers]: ExternalPointer<P>;
}[keyof ExternalIdentifiers];

/** Casts a string to a valid external pointer */
export function isValidExternalPointer(identifier: string): identifier is `${keyof ExternalIdentifiers}1${string}` {
  return parseExternalPointer(identifier) !== null;
}

/**
 * Normalizes a URL according to NIP-73:
 * - Removes fragment
 * - Returns the normalized URL string
 */
function normalizeUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    urlObj.hash = ""; // Remove fragment
    return urlObj.toString();
  } catch {
    // If URL parsing fails, return original (will be caught by validation)
    return url;
  }
}

/** Parses a NIP-73 external identifier */
export function parseExternalPointer<Prefix extends keyof ExternalIdentifiers>(
  identifier: `${Prefix}1${string}`,
): ExternalPointer<Prefix>;
export function parseExternalPointer(identifier: string): ParseResult | null;
export function parseExternalPointer(identifier: string): ParseResult | null {
  // Check explicit prefixes first (these take precedence over URL parsing)
  if (identifier.startsWith("#")) return { kind: "#", identifier: identifier as ExternalIdentifiers["#"] };
  if (identifier.startsWith("geo:")) return { kind: "geo", identifier: identifier as ExternalIdentifiers["geo"] };
  if (identifier.startsWith("isbn:")) return { kind: "isbn", identifier: identifier as ExternalIdentifiers["isbn"] };
  if (identifier.startsWith("podcast:guid:"))
    return { kind: "podcast:guid", identifier: identifier as ExternalIdentifiers["podcast:guid"] };
  if (identifier.startsWith("podcast:item:guid:"))
    return { kind: "podcast:item:guid", identifier: identifier as ExternalIdentifiers["podcast:item:guid"] };
  if (identifier.startsWith("podcast:publisher:guid:"))
    return { kind: "podcast:publisher:guid", identifier: identifier as ExternalIdentifiers["podcast:publisher:guid"] };
  if (identifier.startsWith("isan:")) return { kind: "isan", identifier: identifier as ExternalIdentifiers["isan"] };
  if (identifier.startsWith("doi:")) return { kind: "doi", identifier: identifier as ExternalIdentifiers["doi"] };

  // Check for blockchain identifiers
  // Bitcoin: bitcoin:tx:<txid> or bitcoin:address:<address>
  if (identifier.startsWith("bitcoin:tx:")) {
    return { kind: "bitcoin:tx", identifier: identifier as ExternalIdentifiers["bitcoin:tx"] };
  }
  if (identifier.startsWith("bitcoin:address:")) {
    return { kind: "bitcoin:address", identifier: identifier as ExternalIdentifiers["bitcoin:address"] };
  }

  // Ethereum: ethereum:<chainId>:tx:<txHash> or ethereum:<chainId>:address:<address>
  const ethereumTxMatch = identifier.match(/^ethereum:(\d+):tx:(.+)$/);
  if (ethereumTxMatch) {
    return { kind: "ethereum:tx", identifier: identifier as ExternalIdentifiers["ethereum:tx"] };
  }
  const ethereumAddressMatch = identifier.match(/^ethereum:(\d+):address:(.+)$/);
  if (ethereumAddressMatch) {
    return { kind: "ethereum:address", identifier: identifier as ExternalIdentifiers["ethereum:address"] };
  }

  // Other blockchains: <blockchain>:tx:<txid> or <blockchain>:address:<address>
  // Exclude known prefixes to avoid false matches
  const blockchainTxMatch = identifier.match(/^([a-z0-9]+):tx:(.+)$/);
  if (blockchainTxMatch && !identifier.startsWith("bitcoin:") && !identifier.startsWith("ethereum:")) {
    const blockchain = blockchainTxMatch[1];
    return { kind: `${blockchain}:tx` as keyof ExternalIdentifiers, identifier: identifier as any };
  }
  const blockchainAddressMatch = identifier.match(/^([a-z0-9]+):address:(.+)$/);
  if (blockchainAddressMatch && !identifier.startsWith("bitcoin:") && !identifier.startsWith("ethereum:")) {
    const blockchain = blockchainAddressMatch[1];
    return { kind: `${blockchain}:address` as keyof ExternalIdentifiers, identifier: identifier as any };
  }

  // Check for URL (must be a valid URL, normalized, no fragment)
  // URLs don't have a prefix, so we check if it's a valid URL after checking all prefixes
  try {
    new URL(identifier); // Validate URL
    // Valid URL - normalize it (remove fragment) and return
    const normalized = normalizeUrl(identifier);
    return { kind: "web", identifier: normalized };
  } catch {
    // Not a valid URL
  }

  return null;
}

/** Gets an ExternalPointer for a "i" tag */
export function getExternalPointerFromTag<Prefix extends keyof ExternalIdentifiers>(
  tag: string[],
): ExternalPointer<Prefix> | null;
export function getExternalPointerFromTag(tag: string[]): ParseResult | null;
export function getExternalPointerFromTag(tag: string[]): ParseResult | null {
  if (!tag[1]) return null;
  return parseExternalPointer(tag[1]);
}
