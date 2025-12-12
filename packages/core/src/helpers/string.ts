/** Tests if a string is hex */
export function isHex(str?: string) {
  if (!str) return false;
  if (str.match(/^[0-9a-f]+$/i)) return true;
  return false;
}

/** Tests if a string is a 64 length hex string */
export function isHexKey(key?: string) {
  if (!key) return false;
  if (key.length !== 64) return false;
  if (key.toLowerCase().match(/^[0-9a-f]{64}$/)) return true;
  return false;
}

/**
 * Remove invisible characters from a string
 * @see read more https://www.regular-expressions.info/unicode.html#category
 */
export function stripInvisibleChar(str: string): string;
export function stripInvisibleChar(str?: string | undefined): string | undefined;
export function stripInvisibleChar(str?: string) {
  return str && str.replaceAll(/[\p{Cf}\p{Zs}]/gu, "");
}
