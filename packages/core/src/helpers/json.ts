/** Returns the parsed JSON or undefined if invalid */
export function safeParse<T extends unknown = any>(str: string) {
  try {
    return JSON.parse(str) as T;
  } catch (error) {
    return undefined;
  }
}
