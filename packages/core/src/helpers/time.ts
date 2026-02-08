/** Returns the current unix timestamp */
export function unixNow(): number {
  return Math.round(Date.now() / 1000);
}
