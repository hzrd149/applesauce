// Structural guard for WIRE-12 / audit finding L11 (D-16): closes the
// line-number-mistaken-for-a-section class, where a citation like
// `CORD-06 §94` names something that reads like a section token but is
// actually a line number — CORD-06 only has three real sections.
//
// This guard proves that every `CORD-NN §X` citation anywhere in
// `packages/concord/src` names a section that ACTUALLY EXISTS in that CORD
// document, per the registry vendored in `cord-wire-fixtures.ts`
// (`CORD_SECTIONS`, D-17, branch `main`) — that file is the source of truth
// a reviewer diffs directly against the spec repo. The registry accepts
// named, unnumbered sections (CORD-01 has none of its sections numbered) as
// well as ordinary numeric ones and hyphenated ranges, so this guard does
// not false-fail on those valid, non-numeric citation forms.
//
// Stated limitation (D-16), recorded here verbatim in substance: this guard
// proves a section EXISTS, not that a citation is RIGHT. Rewriting an
// invalid citation to any other in-range section number would pass this
// guard while remaining a wrong citation. The correctness of each citation
// this phase corrected was verified manually by reading the actual CORD
// text at that call site, and that verification is recorded in
// 12-VALIDATION.md's Manual-Only Verifications section — this guard cannot
// and does not re-prove that.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { citationsOutsideRegistry, CORD_SECTIONS } from "./cord-wire-fixtures.js";

// Resolved from this file's own module URL, never from process.cwd() — the
// suite must pass whether vitest is invoked from the repo root or from
// packages/concord.
const SELF = fileURLToPath(import.meta.url);
const SRC_ROOT = join(dirname(SELF), "..");

// `cord-wire-fixtures.test.ts` is the ONE other exclusion, beyond this guard's
// own file. That suite's unit tests for `citationsOutsideRegistry` itself
// construct deliberately-invalid citation strings as string-literal test
// input/expected values (e.g. `"CORD-06 §7"`, `"CORD-09 §1"`) to exercise the
// scanner's own classification logic — they are test fixtures, not
// documentation citations, and they are textually indistinguishable from a
// real citation to a whole-file text scan. Excluding this one file loses no
// real citation coverage (confirmed by direct read: it carries no citation
// comments outside its own test literals) and avoids a permanent, unfixable
// false-positive this guard could never sweep away.
const FIXTURE_SELF_TEST = join(dirname(SELF), "cord-wire-fixtures.test.ts");

/**
 * Recursively collects every `.ts` file under `dir`, including test and
 * fixture files (those carry valid citations too, e.g. the `CORD-01
 * §Deletions` sites in `cord-wire-fixtures.ts` and
 * `helpers/__tests__/keys.test.ts` — a guard that skipped tests would leave
 * those unguarded). The only exclusions are this guard's own file and
 * `cord-wire-fixtures.test.ts` (see comment above).
 */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts") && full !== SELF && full !== FIXTURE_SELF_TEST) out.push(full);
  }
  return out;
}

// A citation-shaped pattern used ONLY to independently count how many
// citations were encountered during the walk — computed without going
// through citationsOutsideRegistry's own valid/invalid filtering, so the
// file-count floor and this count cannot both be zero unnoticed (the second
// anti-vacuity assertion, alongside the file-count floor below).
const CITATION_COUNT_PATTERN = /CORD-\d{2} §[A-Za-z0-9][A-Za-z0-9-]*(?: [A-Z][A-Za-z0-9-]*)*/g;

describe("CORD section citation guard (WIRE-12/D-16)", () => {
  it("scans well over fifty .ts files under packages/concord/src (anti-vacuity: a broken glob cannot pass silently)", () => {
    const files = collectTsFiles(SRC_ROOT);
    expect(files.length).toBeGreaterThan(50);
  });

  it("encountered at least one valid CORD-NN §X citation during the walk (anti-vacuity: a scanner matching nothing cannot pass silently)", () => {
    const files = collectTsFiles(SRC_ROOT);
    let totalCitationMatches = 0;
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      totalCitationMatches += [...text.matchAll(CITATION_COUNT_PATTERN)].length;
    }
    expect(totalCitationMatches).toBeGreaterThan(0);
  });

  it("every CORD-NN §X citation in packages/concord/src names a section that exists", () => {
    const files = collectTsFiles(SRC_ROOT);
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const citation of citationsOutsideRegistry(text)) {
        offenders.push(`${file}: ${citation}`);
      }
    }

    // On failure, the assertion output enumerates every offending
    // file-plus-citation pair, so a future contributor sees which file and
    // which citation without re-running anything.
    expect(offenders).toEqual([]);
  });

  it("the registry itself accepts CORD-01's named sections and CORD-05's numeric range endpoints", () => {
    // Confirms the import actually resolved to a populated registry, not an
    // empty object a typo'd import path could silently produce.
    expect(CORD_SECTIONS["CORD-01"]).toContain("Deletions");
    expect(CORD_SECTIONS["CORD-05"]).toContain("1");
    expect(CORD_SECTIONS["CORD-05"]).toContain("2");
  });
});
