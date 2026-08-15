// Structural guard for CAUTH-03 (D-06): closes the reintroduction class, where
// a future contributor rebuilds the client-wide auth registry, a per-relay
// driver, a proactive relay-status-driven trigger, or a second hand-rolled
// missing-pubkeys handler without any test noticing.
//
// This guard proves the five removed mechanisms — the client-wide auth class,
// its per-relay drivers, its version counter, its reference counting, and its
// status-driven authentication — have zero call sites and zero definitions
// left anywhere in `packages/concord/src` OR `apps/examples/src/examples/concord`,
// and that no non-test file has grown a new ambient-auth trigger, a retry-budget
// override, or a second handler implementation. Mirrors `cord-citations.test.ts`'s
// source-tree-walk precedent, adapted to two roots (RESEARCH.md § Validation
// Architecture, PATTERNS.md § CAUTH-03 structural guard).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Resolved from this file's own module URL, never from process.cwd() — the
// suite must pass whether vitest is invoked from the repo root or from
// packages/concord.
const SELF = fileURLToPath(import.meta.url);
const SRC_ROOT = join(dirname(SELF), "..");
// packages/concord/src/__tests__ -> packages/concord/src -> packages/concord ->
// packages -> repo root -> apps/examples/src/examples/concord.
const EXAMPLES_ROOT = join(dirname(SELF), "..", "..", "..", "..", "apps", "examples", "src", "examples", "concord");

/**
 * Recursively collects every file under `dir` matching one of `extensions`,
 * excluding this guard's own file (`SELF`) — it necessarily contains every
 * forbidden literal below as regex source, and would otherwise flag itself.
 */
function collectFiles(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...collectFiles(full, extensions));
    else if (extensions.some((ext) => entry.endsWith(ext)) && full !== SELF) out.push(full);
  }
  return out;
}

const isTestPath = (path: string): boolean => path.includes("__tests__");

// The five removed mechanisms — the deleted class name, the driver-authentication
// method, the old key-registration method name, the status-driven user-auth
// option, the removed per-engine driver-synchronisation method, the removed
// manual user-authenticate method, and the removed relay-wide-flag needs-auth
// predicate.
const REMOVED_MECHANISMS =
  /ConcordRelayAuth|authenticateStreamKeys|registerStreamKeys|autoAuthenticate|ensureAuth|authenticateUser|userNeedsAuth/;

// The relay challenge observable and the two relay-wide auth-required flags —
// D-01 forbids any proactive reader of these; auth only ever fires reactively
// off a relay's own refusal of an operation.
const AMBIENT_AUTH_TRIGGER = /challenge\$|authRequiredForRead|authRequiredForPublish/;

// D-05 keeps every concord call site on the upstream defaults (1 retry,
// 30_000ms) — the concord-side half of CAUTH-04's parity claim.
const RETRY_BUDGET_OVERRIDE = /authRetries|authTimeout/;

// The relay-supplied missing-pubkeys field — only `client/auth.ts` may
// implement a handler that reads it; a second copy elsewhere is exactly how a
// scope ends up authenticating a key it does not own (T-15-01).
const MISSING_PUBKEYS_FIELD = /missingPubkeys/;
const AUTH_HANDLER_FILE = join(SRC_ROOT, "client", "auth.ts");

describe("no ambient auth guard (CAUTH-03/D-06)", () => {
  it("scans well over fifty .ts files under packages/concord/src and at least four under the concord examples (anti-vacuity: a broken path cannot pass silently)", () => {
    const packageFiles = collectFiles(SRC_ROOT, [".ts", ".tsx"]);
    expect(packageFiles.length).toBeGreaterThan(50);

    expect(statSync(EXAMPLES_ROOT).isDirectory()).toBe(true);
    const exampleFiles = collectFiles(EXAMPLES_ROOT, [".ts", ".tsx"]);
    expect(exampleFiles.length).toBeGreaterThanOrEqual(4);
  });

  it("no file in either root names any of the five removed mechanisms (tests included)", () => {
    const files = [...collectFiles(SRC_ROOT, [".ts", ".tsx"]), ...collectFiles(EXAMPLES_ROOT, [".ts", ".tsx"])];
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (REMOVED_MECHANISMS.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("no non-test file under packages/concord/src subscribes to a relay challenge stream or reads a relay-wide auth-required flag", () => {
    const files = collectFiles(SRC_ROOT, [".ts", ".tsx"]).filter((f) => !isTestPath(f));
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (AMBIENT_AUTH_TRIGGER.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("no non-test file under packages/concord/src overrides the auth retry count or the auth timeout", () => {
    const files = collectFiles(SRC_ROOT, [".ts", ".tsx"]).filter((f) => !isTestPath(f));
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (RETRY_BUDGET_OVERRIDE.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it("only client/auth.ts implements a handler over the relay-supplied missing-pubkeys field — one handler, not a family of hand-rolled copies", () => {
    const files = collectFiles(SRC_ROOT, [".ts", ".tsx"]).filter((f) => f !== AUTH_HANDLER_FILE && !isTestPath(f));
    const offenders: string[] = [];

    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (MISSING_PUBKEYS_FIELD.test(text)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
