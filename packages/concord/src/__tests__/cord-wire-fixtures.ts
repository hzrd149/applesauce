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
