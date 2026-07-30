// Vendored, verbatim transcription of the CORD spec repo's `examples.md`
// (github.com/concord-protocol/concord, branch `main`). A reviewer should
// diff this file directly against that source file when auditing any
// WIRE-02/03/04/05 assertion in this phase. Carrying forward `examples.md`'s
// own disclaimer: Non-normative — if an example here disagrees with a CORD,
// the CORD wins.
//
// Tag ORDER in the emitted rumors below is an artifact of our own
// composition order, not a spec rule: concord's `bindToChannel` appends its
// `channel`/`epoch`/`ms` binding tags AFTER the factory's own tags, whereas
// `examples.md` lists them first. `examples.md` is non-normative on
// ordering, and asserting positional array equality would pin our own
// composition order rather than the spec. Downstream assertions must
// therefore compare tag sets order-independently (see `missingFixtureTags`
// below), by construction.

export type CordWireExample = {
  section: string;
  alsoCited?: string;
  kind: number;
  content: string;
  tags: readonly (readonly string[])[];
};

export const CORD_EXAMPLES_SOURCE = {
  repo: "github.com/concord-protocol/concord",
  branch: "main",
  file: "examples.md",
};

export const CORD_EXAMPLES_CAVEAT =
  "Non-normative — if an example here disagrees with a CORD, the CORD wins.";

export const REACTION_KIND7_EXAMPLE: CordWireExample = {
  section: "examples.md §2.3 Kind 7 — Reaction",
  kind: 7,
  content: "🔥",
  tags: [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "112"],
    ["e", "<message rumor id>"],
    ["p", "<message author>"],
    ["k", "9"],
  ],
};

export const THREADED_REPLY_KIND1111_EXAMPLE: CordWireExample = {
  section: "examples.md §2.2 Kind 1111 — Threaded reply",
  alsoCited: "CORD-03 §3",
  kind: 1111,
  content: "Replying in the thread!",
  tags: [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "744"],
    ["K", "9"],
    ["E", "<thread root rumor id>", "", "<root author>"],
    ["P", "<root author>"],
    ["k", "9"],
    ["e", "<immediate parent rumor id>", "", "<parent author>"],
    ["p", "<parent author>"],
  ],
};

export const DELETE_KIND5_EXAMPLE: CordWireExample = {
  section: "examples.md §2.4 Kind 5 — Delete",
  alsoCited: "CORD-01 §Deletions",
  kind: 5,
  content: "",
  tags: [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "533"],
    ["e", "<own message rumor id>"],
    ["k", "9"],
  ],
};

export const VOICE_PRESENCE_JOINED_EXAMPLE: CordWireExample = {
  section: "examples.md §2.8 Kind 23313 — Voice presence",
  alsoCited: "CORD-07 §4",
  kind: 23313,
  content: "joined",
  tags: [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["identity", "<SFU identity>"],
    ["broker", "https://broker.example"],
    ["ms", "417"],
  ],
};

export const VOICE_PRESENCE_LEFT_EXAMPLE: CordWireExample = {
  section: "examples.md §2.8 Kind 23313 — Voice presence",
  alsoCited: "CORD-07 §4",
  kind: 23313,
  content: "left",
  tags: [
    ["channel", "<channel_id>"],
    ["epoch", "0"],
    ["ms", "902"],
  ],
};

// Verbatim prose rules — the authority for assertions `examples.md` gives no
// tag set for (specifically depth-2 reply nesting).

export const CORD_REPLY_ROOT_INHERITANCE_RULE =
  "Uppercase K/E/P pin the immutable thread root; lowercase k/e/p pin the immediate parent. All ids are rumor ids (never the outer wrap's). When the parent is itself a reply, its uppercase root tags are inherited verbatim, so the root stays stable at any nesting depth. (examples.md §2.2 Kind 1111 — Threaded reply)";

export const CORD_TARGET_KIND_RULE =
  "Reactions, edits, and deletes target a threaded reply exactly as they target a kind-9 message (by its rumor id); the k tag they carry names the target's kind (1111 for a reply, 9 for a message). (examples.md §2.2 Kind 1111 — Threaded reply)";

const PLACEHOLDER_PATTERN = /^<.+>$/;

/**
 * Returns a new `string[][]` with every placeholder token (an angle-bracket
 * delimited element, e.g. `<channel_id>`) replaced by its bound value.
 * Throws if a placeholder present in `tags` has no entry in `bindings`, so a
 * mis-typed binding cannot silently degrade into a comparison against the
 * literal placeholder text. Non-placeholder elements, including the
 * empty-string relay slot, pass through byte-identical.
 */
export function substituteFixtureTags(
  tags: readonly (readonly string[])[],
  bindings: Record<string, string>,
): string[][] {
  return tags.map((tag) =>
    tag.map((element) => {
      if (!PLACEHOLDER_PATTERN.test(element)) return element;
      if (!(element in bindings)) {
        throw new Error(`substituteFixtureTags: unresolved placeholder ${element}`);
      }
      return bindings[element]!;
    }),
  );
}

function tagsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Returns the subset of `expected` for which no entry of `actual` is
 * element-wise deep-equal (same length AND same value at every index).
 * Returns an empty array when every expected tag is present. Order- and
 * extras-independent by design (see module header comment).
 */
export function missingFixtureTags(
  actual: readonly (readonly string[])[],
  expected: readonly (readonly string[])[],
): (readonly string[])[] {
  return expected.filter((expectedTag) => !actual.some((actualTag) => tagsEqual(actualTag, expectedTag)));
}

/**
 * Returns the index-1 value of every tag whose index-0 element equals
 * `name`, in encounter order. Returns an empty array when none match.
 */
export function tagValues(tags: readonly (readonly string[])[], name: string): string[] {
  return tags.filter((tag) => tag[0] === name).map((tag) => tag[1]!);
}

// ---------------------------------------------------------------------------
// CORD cap literals, section registry, and a multi-byte UTF-8 generator
// (TEST-01 / D-21). Every constant below is a hand transcription of verbatim
// CORD spec text or its section headers, fetched from
// `github.com/concord-protocol/concord@main` and recorded in
// `12-RESEARCH.md`. Nothing here may be imported from, or compared against,
// `helpers/caps.ts`, `helpers/community-list.ts`, or any other concord source
// module — the whole point of this registry is that it is spec-side only, so
// a cap test that asserts against it can never be constant-anchored to the
// implementation it is testing. `cord-wire-fixtures.test.ts` proves the cap
// literals below match the numbers parsed back out of their own verbatim
// sentences, so a transcription error fails a test instead of silently
// becoming this phase's false oracle.

export const CORD_SECTIONS_SOURCE = {
  repo: "github.com/concord-protocol/concord",
  branch: "main",
  files: "01.md through 07.md (the repo does not use a `CORD-NN.md` naming convention)",
};

/**
 * Every CORD-01..07 section identifier, transcribed from the live repo's
 * actual `##`/`###` headers. CORD-01 uses named, unnumbered sections; every
 * other document numbers its sections, plus CORD-02's two lettered
 * appendices. `citationsOutsideRegistry` below accepts both shapes.
 */
export const CORD_SECTIONS: Record<string, readonly string[]> = {
  "CORD-01": [
    "Stream Event",
    "Encrypted vs plaintext seals",
    "Encoding",
    "Binding",
    "Deletions",
    "Removing Participants",
  ],
  "CORD-02": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "Appendix A", "Appendix B"],
  "CORD-03": ["1", "2", "3"],
  "CORD-04": ["1", "2", "3", "4", "5", "6"],
  "CORD-05": ["1", "2", "3", "4", "5", "6"],
  "CORD-06": ["1", "2", "3"],
  "CORD-07": ["1", "2", "3", "4", "5", "6", "7"],
};

/**
 * Verbatim CORD-02 §6 sentence pair stating the `name`/`description` byte
 * caps. `cord-wire-fixtures.test.ts` parses the two numbers back out of this
 * string with a regex and asserts they equal `CORD_METADATA_CAPS` below, so a
 * mis-transcription here fails loudly instead of silently mis-anchoring every
 * downstream cap test (D-21).
 */
export const CORD_METADATA_CAP_SENTENCE =
  "The `name` caps at 64 bytes and the `description` at 10000 bytes, counted as UTF-8. " +
  "The 64-byte name cap is uniform across the protocol (Channels and Roles carry the same one).";

/** Transcribed from `CORD_METADATA_CAP_SENTENCE` above (D-05). */
export const CORD_METADATA_CAPS = {
  nameBytes: 64,
  descriptionBytes: 10000,
};

/**
 * Verbatim CORD-02 §6 round-trip MUST — the authority plans 12-06/12-07/12-08
 * cite for WIRE-09/WIRE-10 (D-13): an editor MUST round-trip fields it
 * doesn't understand, top-level fields outside `custom` are reserved for the
 * protocol, and the same object is permitted on ChannelMetadata.
 */
export const CORD_ROUND_TRIP_SENTENCE =
  "An editor MUST round-trip fields it doesn't understand (editing the name never wipes " +
  "another client's rules)... Top-level fields outside `custom` are reserved for the " +
  "protocol. The same object is permitted on ChannelMetadata (CORD-03).";

/**
 * Verbatim CORD-02 §8 passage. `cord-wire-fixtures.test.ts` parses the `50`
 * back out of this string and asserts it equals
 * `CORD_COMMUNITY_LIST_MEMBERSHIP_CAP` below, the same self-test treatment as
 * `CORD_METADATA_CAP_SENTENCE` (D-06).
 */
export const CORD_COMMUNITY_LIST_CAP_SENTENCE =
  "The List caps at 50 memberships: it is one NIP-44 event, and NIP-44 plaintext hard-caps " +
  "at 65,535 bytes, so the cap is a protocol constant, not client taste. The count is not " +
  "the whole budget — join material carrying private-channel keys can overflow the event " +
  "well below 50 — so a client MUST verify the serialized List fits before publishing. The " +
  "round-trip discipline applies here too (§6): preserve what you don't understand.";

/** Transcribed from `CORD_COMMUNITY_LIST_CAP_SENTENCE` above (D-06). */
export const CORD_COMMUNITY_LIST_MEMBERSHIP_CAP = 50;

/**
 * Verbatim CORD-02 Appendix B sentence — the MUST-enforce-the-cap-at-every-
 * layer text. D-07 deliberately overrides this MUST because its premise
 * moved upstream: NIP-44 now specifies `max_plaintext_size` = 4294967295 and
 * demotes 65536 to `extended_prefix_threshold`. Per D-21, no assertion in
 * this package may anchor 65535 to a NIP-44 spec value — byte-related
 * assertions cite CORD-02 instead.
 */
export const CORD_APPENDIX_B_SENTENCE =
  "Every layer of the nesting is a NIP-44 plaintext, and NIP-44 hard-caps plaintext at " +
  "65,535 bytes: implementations MUST enforce the cap at every layer themselves (libraries " +
  "are lenient, and a lenient publisher mints events a strict reader cannot decrypt).";

/**
 * U+1D518 MATHEMATICAL FRAKTUR CAPITAL U ("𝔘") — 4 bytes in UTF-8, 2 UTF-16
 * code units (it lies above the Basic Multilingual Plane, so JS represents it
 * as a surrogate pair). Repeating this character is how the generators below
 * land at an exact UTF-8 byte count while staying strictly less than that
 * count in UTF-16 `.length` — the divergence a byte-cap test must exercise
 * (D-21) so an accidental ASCII test string can never silently pass.
 */
export const MULTIBYTE_ASTRAL_CHAR = "\u{1D518}";

/**
 * UTF-8 byte length of `value`. Deliberately named `utf8Bytes`, NOT the same
 * name as `helpers/caps.ts`'s `utf8ByteLength`: a cap test measures with this
 * fixture helper, so it cannot accidentally measure with the implementation
 * it is testing (D-21).
 */
export function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * A string of `MULTIBYTE_ASTRAL_CHAR` repeats whose UTF-8 byte length is
 * exactly `n`. Throws when `n` is not a non-negative multiple of 4 — the
 * astral character is 4 bytes, so no other value can land exactly. Both cap
 * values this phase uses (64 and 10000) are multiples of 4.
 */
export function multiByteStringOfBytes(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n % 4 !== 0) {
    throw new Error(
      `multiByteStringOfBytes: n must be a non-negative multiple of 4 (the astral fixture ` +
        `character is 4 UTF-8 bytes each); got ${n}`,
    );
  }
  return MULTIBYTE_ASTRAL_CHAR.repeat(n / 4);
}

/** The shortest `MULTIBYTE_ASTRAL_CHAR` repeat whose UTF-8 byte length is strictly greater than `n`. */
export function multiByteStringOverBytes(n: number): string {
  const charCount = Math.floor(n / 4) + 1;
  return MULTIBYTE_ASTRAL_CHAR.repeat(charCount);
}

/**
 * Matches a `CORD-NN §token` citation. The token is a first "word" of
 * letters/digits/hyphens (covering both a bare section number and a
 * hyphenated range like `1-2`), optionally followed by further
 * capitalized-initial words (covering a named, multi-word section like
 * `Appendix B`). Trailing punctuation immediately after the token (a colon,
 * comma, period, closing paren, semicolon, or quote) is excluded from the
 * character class by construction, not matched at all.
 */
const CITATION_PATTERN = /CORD-(\d{2}) §([A-Za-z0-9][A-Za-z0-9-]*(?: [A-Z][A-Za-z0-9-]*)*)/g;

/**
 * Strips any trailing punctuation a looser upstream capture might sweep in
 * (colon, comma, period, closing paren, semicolon, quote, or a
 * comment-terminating sequence such as a closing block comment or an HTML
 * comment close) before the token is looked up in `CORD_SECTIONS`.
 * Defensive: `CITATION_PATTERN`'s character class already excludes these,
 * but a citation token is never trusted un-cleaned.
 */
function stripTrailingPunctuation(token: string): string {
  return token.replace(/(:|,|\.|\)|;|"|'|\*\/|-->)+$/, "");
}

/**
 * Returns, in encounter order, every `CORD-NN §X` citation in `text` whose
 * document is absent from `CORD_SECTIONS` or whose section is not one of
 * that document's registered sections. A hyphenated range (`§1-2`) is valid
 * only when EVERY endpoint is registered. Named sections (CORD-01) match by
 * exact string.
 *
 * D-16's stated limitation, verbatim in substance: this check proves a
 * section EXISTS, not that a citation is RIGHT. Changing a bad citation to
 * any in-range number would pass while remaining wrong. It closes the
 * line-number-mistaken-for-a-section class specifically; the correctness of
 * each replacement is a reviewer's manual diff against the spec repo,
 * recorded in `12-VALIDATION.md` § Manual-Only Verifications.
 */
export function citationsOutsideRegistry(text: string): string[] {
  const invalid: string[] = [];
  for (const match of text.matchAll(CITATION_PATTERN)) {
    const doc = `CORD-${match[1]}`;
    const token = stripTrailingPunctuation(match[2]!);
    const sections = CORD_SECTIONS[doc];

    let valid: boolean;
    if (!sections) {
      valid = false;
    } else if (token.includes("-")) {
      valid = token.split("-").every((part) => sections.includes(part));
    } else {
      valid = sections.includes(token);
    }

    if (!valid) invalid.push(`${doc} §${token}`);
  }
  return invalid;
}
