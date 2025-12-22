export type ExternalIdentifiers = {
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

/** Parses a NIP-73 external identifier */
export function parseExternalPointer<Prefix extends keyof ExternalIdentifiers>(
  identifier: `${Prefix}1${string}`,
): ExternalPointer<Prefix>;
export function parseExternalPointer(identifier: string): ParseResult | null;
export function parseExternalPointer(identifier: string): ParseResult | null {
  if (identifier.startsWith("#")) return { kind: "#", identifier: identifier as ExternalIdentifiers["#"] };
  if (identifier.startsWith("geo:")) return { kind: "geo", identifier: identifier as ExternalIdentifiers["geo"] };
  if (identifier.startsWith("podcast:guid:"))
    return { kind: "podcast:guid", identifier: identifier as ExternalIdentifiers["podcast:guid"] };
  if (identifier.startsWith("podcast:item:guid:"))
    return { kind: "podcast:item:guid", identifier: identifier as ExternalIdentifiers["podcast:item:guid"] };
  if (identifier.startsWith("podcast:publisher:guid:"))
    return { kind: "podcast:publisher:guid", identifier: identifier as ExternalIdentifiers["podcast:publisher:guid"] };
  if (identifier.startsWith("isan:")) return { kind: "isan", identifier: identifier as ExternalIdentifiers["isan"] };
  if (identifier.startsWith("doi:")) return { kind: "doi", identifier: identifier as ExternalIdentifiers["doi"] };

  return null;
}

/** Gets an ExternalPointer for a "i" tag */
export function getExternalPointerFromTag<Prefix extends keyof ExternalIdentifiers>(
  tag: string[],
): ExternalPointer<Prefix> | null;
export function getExternalPointerFromTag(tag: string[]): ParseResult | null;
export function getExternalPointerFromTag(tag: string[]): ParseResult | null {
  return parseExternalPointer(tag[1]);
}
