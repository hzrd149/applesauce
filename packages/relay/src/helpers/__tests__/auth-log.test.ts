import type { Filter } from "applesauce-core/helpers/filter";
import { describe, expect, it } from "vitest";

import type { RelayAuthWireRequest } from "../../types.js";
import {
  AUTH_LOG_ID_LENGTH,
  AUTH_LOG_KINDS_LIMIT,
  AUTH_LOG_TEXT_LIMIT,
  describeAuthRequirement,
  describeWireRequest,
  shortId,
  summarizeFilter,
  summarizeFilters,
  truncateForLog,
} from "../auth-log.js";

describe("summarizeFilter", () => {
  it("spells out kinds and counts every other field (D-06 example shape)", () => {
    const filter: Filter = { kinds: [1, 7], authors: ["aaaa", "bbbb", "cccc"], "#e": ["eee1", "eee2"], limit: 50 };
    expect(summarizeFilter(filter)).toBe("kinds=[1,7] authors=3 #e=2 limit=50");
  });

  it("caps kinds at AUTH_LOG_KINDS_LIMIT and appends an elision marker", () => {
    const kinds = Array.from({ length: 25 }, (_, i) => i + 1);
    const capped = kinds.slice(0, AUTH_LOG_KINDS_LIMIT).join(",");
    expect(summarizeFilter({ kinds })).toBe(`kinds=[${capped},+5 more]`);
  });

  it("prints limit/since/until values directly and search as a character count", () => {
    expect(summarizeFilter({ since: 100, until: 200 })).toBe("since=100 until=200");
    expect(summarizeFilter({ search: "hello world" })).toBe("search=11chars");
  });

  it("prints an array length for ids/authors/unknown keys and 1 for a non-array value", () => {
    expect(summarizeFilter({ ids: ["a", "b"] })).toBe("ids=2");
    expect(summarizeFilter({ "&e": ["x"] } as unknown as Filter)).toBe("&e=1");
  });

  it("renders an empty filter object as a fixed placeholder", () => {
    expect(summarizeFilter({})).toBe("(empty filter)");
  });

  it("does not throw when kinds is present but not an array (WR-04)", () => {
    // A filter is caller-supplied and only weakly typed; the old `(record.kinds as number[] | undefined)
    // ?? []` cast only caught undefined, not a truthy non-array like `{ kinds: 1 }`, which reached
    // Array.prototype.slice on a number and threw from inside a socket map/tap.
    expect(() => summarizeFilter({ kinds: 1 } as unknown as Filter)).not.toThrow();
    expect(summarizeFilter({ kinds: 1 } as unknown as Filter)).toBe("kinds=[]");
  });
});

describe("summarizeFilters", () => {
  it("returns a fixed placeholder for an empty array", () => {
    expect(summarizeFilters([])).toBe("(no filters)");
  });

  it("delegates to summarizeFilter for a single-element array", () => {
    expect(summarizeFilters([{ kinds: [1] }])).toBe("kinds=[1]");
  });

  it("unions kinds across filters in first-seen order, deduplicated, for 2+ filters", () => {
    const filters: Filter[] = [{ kinds: [1, 2] }, { kinds: [2, 3] }];
    expect(summarizeFilters(filters)).toBe("2 filters kinds=[1,2,3]");
  });

  it("returns just the count when no filter in a 2+ array declares kinds", () => {
    const filters: Filter[] = [{ ids: ["a"] }, { authors: ["b"] }];
    expect(summarizeFilters(filters)).toBe("2 filters");
  });

  it("does not throw when a filter's kinds is present but not an array (WR-04)", () => {
    // The old `if (!filterKinds) continue;` only skipped falsy values, so a truthy non-array (e.g.
    // `{ kinds: 1 }`) reached `for (const kind of filterKinds)` on a non-iterable and threw.
    const filters = [{ kinds: 1 }, { kinds: [2] }] as unknown as Filter[];
    expect(() => summarizeFilters(filters)).not.toThrow();
    expect(summarizeFilters(filters)).toBe("2 filters kinds=[2]");
  });
});

describe("describeWireRequest", () => {
  it("renders REQ/COUNT with shortId(id) and the summarized filters", () => {
    const req: RelayAuthWireRequest = { verb: "REQ", id: "reqid1234", filters: [{ kinds: [1] }] };
    expect(describeWireRequest(req)).toBe("REQ reqid123 kinds=[1]");

    const count: RelayAuthWireRequest = { verb: "COUNT", id: "countid99", filters: [{ ids: ["a", "b"] }] };
    expect(describeWireRequest(count)).toBe("COUNT countid9 ids=2");
  });

  it("renders EVENT with shortId(event.id) and the kind", () => {
    const event: RelayAuthWireRequest = {
      verb: "EVENT",
      event: { id: "1234567890abcdef", kind: 1, pubkey: "p", created_at: 0, tags: [], content: "", sig: "" } as never,
    };
    expect(describeWireRequest(event)).toBe("EVENT 12345678 kind=1");
  });

  it("renders NEG-OPEN with shortId(id) and the single-filter summary", () => {
    const negOpen: RelayAuthWireRequest = { verb: "NEG-OPEN", id: "abcdefgh12345", filter: { kinds: [1] } };
    expect(describeWireRequest(negOpen)).toBe("NEG-OPEN abcdefgh kinds=[1]");
  });

  it("degrades to a fallback string instead of throwing on an unrecognized verb (WR-04)", () => {
    // The default branch is unreachable through the type system today, but this function is called
    // from inside a socket map/tap/catchError at every relay.ts call site -- a throw here would error
    // the whole stream rather than just producing an imprecise log line.
    const malformed = { verb: "BOGUS" } as unknown as RelayAuthWireRequest;
    expect(() => describeWireRequest(malformed)).not.toThrow();
    expect(describeWireRequest(malformed)).toContain("BOGUS");
  });
});

describe("shortId", () => {
  it("returns the leading AUTH_LOG_ID_LENGTH characters, unchanged when already shorter", () => {
    expect(shortId("abcdefghij")).toBe("abcdefgh");
    expect(shortId("abcdefghij").length).toBe(AUTH_LOG_ID_LENGTH);
    expect(shortId("abc")).toBe("abc");
  });
});

describe("truncateForLog", () => {
  it("leaves a short string untouched", () => {
    expect(truncateForLog("hello")).toBe("hello");
  });

  it("coerces null/undefined to an empty string", () => {
    expect(truncateForLog(null)).toBe("");
    expect(truncateForLog(undefined)).toBe("");
  });

  it("bounds an oversized string to AUTH_LOG_TEXT_LIMIT plus a dropped-character suffix", () => {
    const longText = "x".repeat(300);
    const result = truncateForLog(longText);
    expect(result).toBe(`${"x".repeat(AUTH_LOG_TEXT_LIMIT)}…(+44 more chars)`);
  });

  // CR-01: `debug` (common.js) treats its first argument as a printf-style format string, running a
  // `%`-replacement pass before util.formatWithOptions ever runs — every relay-controlled string that
  // flows through this formatter is later interpolated into that same argument at its call site.

  it("doubles every % so debug's %-replacement pass cannot consume a non-existent argument (CR-01 specifier vector)", () => {
    // %o/%O are real createDebug.formatters entries; with no corresponding argument they would render
    // `undefined` and destroy the actual challenge/reason text an operator is reading the line for.
    // %%/%s go through the same doubling. Verified empirically against the real debug@4.4.3 in this
    // workspace: doubling here is what makes debug's own %-pass collapse %% back to a literal % and
    // leave %%o/%%O/%%s untouched (debug only recognizes single-% specifiers).
    expect(truncateForLog("chal-%o-%O-100%-%s")).toBe("chal-%%o-%%O-100%%-%%s");
  });

  it("escapes control characters as \\xHH so a raw newline cannot start a second physical log line (CR-01 forging vector)", () => {
    // A raw \n in a relay-controlled reason/message lets a hostile relay forge a line byte-identical to
    // a genuine connection-track line (CWE-117) once interpolated into debug's output. Escaping (never
    // silently deleting) keeps the operator able to see that a hostile value was received.
    const forged = "denied\n  t:auth Relay accepted AUTH for deadbeef: ok";
    const result = truncateForLog(forged);
    expect(result).not.toContain("\n");
    expect(result).toBe("denied\\x0a  t:auth Relay accepted AUTH for deadbeef: ok");
  });

  it("leaves ordinary printable text (including literal backslashes) untouched aside from the % doubling", () => {
    expect(truncateForLog("plain reason, no specifiers")).toBe("plain reason, no specifiers");
    expect(truncateForLog("a\\backslash")).toBe("a\\backslash");
  });

  it("does not throw when String(value) itself throws (WR-04)", () => {
    // At auth-retry.ts's two handler-error call sites, `value` is whatever a caller's onAuthRequired
    // threw/rejected with -- a poisoned toString/Symbol.toPrimitive would otherwise throw from inside a
    // catch, defeating CR-04's "both failure modes are indistinguishable to the caller" invariant.
    const poisoned = {
      toString() {
        throw new Error("poisoned");
      },
    };
    expect(() => truncateForLog(poisoned)).not.toThrow();
    expect(truncateForLog(poisoned)).toBe("(unstringifiable value)");
  });
});

describe("describeAuthRequirement", () => {
  it("renders a boolean as a phrase naming any authenticated pubkey", () => {
    expect(describeAuthRequirement(true)).toBe("any authenticated pubkey");
  });

  it("renders a single pubkey as itself", () => {
    expect(describeAuthRequirement("pubkey1")).toBe("pubkey1");
  });

  it("renders an array as its comma-joined pubkeys", () => {
    expect(describeAuthRequirement(["pk1", "pk2"])).toBe("pk1,pk2");
  });
});
