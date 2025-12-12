/** A tag with at least two indexes, the first being the name, the second the value */
export type NameValueTag<Name extends string = string> = [Name, string, ...string[]];

/** Tests if a tag has at least two indexes, and optionally the value of the first */
export function isNameValueTag<Name extends string>(tag: string[], name?: Name): tag is NameValueTag<Name> {
  return tag[0] !== undefined && tag[1] !== undefined && (name ? tag[0] === name : true);
}

/** Checks if tag is an "e" tag and has at least one value */
export function isETag(tag: string[]): tag is ["e", string, ...string[]] {
  return isNameValueTag(tag, "e");
}
/** Checks if tag is an "p" tag and has at least one value */
export function isPTag(tag: string[]): tag is ["p", string, ...string[]] {
  return isNameValueTag(tag, "p");
}
/** Checks if tag is an "r" tag and has at least one value */
export function isRTag(tag: string[]): tag is ["r", string, ...string[]] {
  return isNameValueTag(tag, "r");
}
/** Checks if tag is an "d" tag and has at least one value */
export function isDTag(tag: string[]): tag is ["d", string, ...string[]] {
  return isNameValueTag(tag, "d");
}
/** Checks if tag is an "a" tag and has at least one value */
export function isATag(tag: string[]): tag is ["a", string, ...string[]] {
  return isNameValueTag(tag, "a");
}
/** Checks if tag is an "t" tag and has at least one value */
export function isTTag(tag: string[]): tag is ["t", string, ...string[]] {
  return isNameValueTag(tag, "t");
}
/** Checks if tag is an "q" tag and has at least one value */
export function isQTag(tag: string[]): tag is ["q", string, ...string[]] {
  return isNameValueTag(tag, "q");
}

/** Filter and transform tags */
export const processTags: TagPipe = (tags: string[][], ...fns: Function[]) => {
  return fns.reduce((step, fn) => {
    const next: unknown[] = [];

    for (const value of step) {
      try {
        const result = fn(value);
        if (result === undefined) continue; // value is undefined, ignore

        next.push(result);
      } catch (error) {
        // failed to process value, ignore
      }
    }

    return next;
  }, tags as unknown[]);
};

/** A pipeline that filters and maps each tag */
type TagPipe = {
  <A>(tags: string[][], ta: (tag: string[]) => A | undefined): A[];
  <A, B>(tags: string[][], ta: (tag: string[]) => A | undefined, ab: (a: A) => B | undefined): B[];
  <A, B, C>(
    tags: string[][],
    ta: (tag: string[]) => A | undefined,
    ab: (a: A) => B | undefined,
    bc: (b: B) => C | undefined,
  ): C[];
  <A, B, C, D>(
    tags: string[][],
    ta: (tag: string[]) => A | undefined,
    ab: (a: A) => B | undefined,
    bc: (b: B) => C | undefined,
    cd: (c: C) => D | undefined,
  ): D[];
  <A, B, C, D, E>(
    tags: string[][],
    ta: (tag: string[]) => A | undefined,
    ab: (a: A) => B | undefined,
    bc: (b: B) => C | undefined,
    cd: (c: C) => D | undefined,
    de: (d: D) => E | undefined,
  ): E[];
  <A, B, C, D, E, F>(
    tags: string[][],
    ta: (tag: string[]) => A | undefined,
    ab: (a: A) => B | undefined,
    bc: (b: B) => C | undefined,
    cd: (c: C) => D | undefined,
    de: (d: D) => E | undefined,
    ef: (e: E) => F | undefined,
  ): F[];
  <A, B, C, D, E, F, G>(
    tags: string[][],
    ta: (tag: string[]) => A | undefined,
    ab: (a: A) => B | undefined,
    bc: (b: B) => C | undefined,
    cd: (c: C) => D | undefined,
    de: (d: D) => E | undefined,
    ef: (e: E) => F | undefined,
    fg: (f: F) => G | undefined,
  ): G[];
};

/** Replaces null and undefined with "" in tags and trims them down to a set length if they ends with "" */
export function fillAndTrimTag(tag: (string | undefined | null)[], minLength = 2): string[] {
  // clone array
  tag = tag.slice();

  for (let i = tag.length - 1; i >= 0; i--) {
    if (tag[i] === undefined || tag[i] === null || tag[i] === "") {
      if (i + 1 === tag.length && i >= minLength) {
        // this is the last index, remove it
        tag.pop();
      } else {
        // blank tag
        tag[i] = "";
      }
    }
  }

  return tag as string[];
}

/** Ensures a single named tag exists */
export function ensureSingletonTag(tags: string[][], tag: [string, ...string[]], replace = true): string[][] {
  const existing = tags.find((t) => t[0] === tag[0]);

  if (existing) {
    if (replace) return tags.map((t) => (t === existing ? tag : t));
    else return tags;
  } else {
    return [...tags, tag];
  }
}

/** Ensures a single named / value tag exists */
export function ensureNamedValueTag(
  tags: string[][],
  tag: [string, string, ...string[]],
  replace = true,
  matcher?: (a: string, b: string) => boolean,
): string[][] {
  const existing = tags.find((t) => t[0] === tag[0] && t[1] && (matcher ? matcher(t[1], tag[1]) : t[1] === tag[1]));

  if (existing) {
    if (replace) return tags.map((t) => (t === existing ? tag : t));
    else return tags;
  } else {
    return [...tags, tag];
  }
}
