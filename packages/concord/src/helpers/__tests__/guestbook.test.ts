import { describe, expect, it } from "vitest";

import type { Role } from "../../types.js";
import { foldMembers } from "../guestbook.js";
import { resolveStanding } from "../permissions.js";
import { decoded } from "./test-utils.js";

describe("guestbook fold", () => {
  it("coalesces joins/leaves, honors banlist", () => {
    const join = (pk: string, ms: number) =>
      decoded({ kind: 3306, content: "join", tags: [["ms", String(ms % 1000)]] }, pk, ms);
    const leave = (pk: string, ms: number) =>
      decoded({ kind: 3306, content: "leave", tags: [["ms", String(ms % 1000)]] }, pk, ms);
    const owner = "owner";
    const roles = new Map<string, Role>();
    const grants = new Map<string, string[]>();
    const standing = (m: string) => resolveStanding(m, owner, roles, grants);
    const members = foldMembers(
      [join("alice", 1_000), join("bob", 1_000), leave("bob", 2_000)],
      new Map(),
      new Set(["carol"]),
      standing,
      10_000,
    );
    expect(members.has("alice")).toBe(true);
    expect(members.has("bob")).toBe(false); // left
    expect(members.has("carol")).toBe(false); // banned
  });

  const owner = "owner";
  const standing = (m: string) => resolveStanding(m, owner, new Map<string, Role>(), new Map<string, string[]>());

  it("honors a snapshot only from the epoch's refounder", () => {
    const snap = (author: string, members: string[], ms: number) =>
      decoded(
        {
          kind: 3312,
          content: JSON.stringify(members),
          tags: [
            ["snap", "s1", "1", "1"],
            ["ms", String(ms % 1000)],
          ],
        },
        author,
        ms,
      );

    // From an arbitrary member: ignored.
    const forged = foldMembers(
      [snap("mallory", ["victim"], 1_000)],
      new Map(),
      new Set(),
      standing,
      10_000,
      "refounder",
    );
    expect(forged.has("victim")).toBe(false);

    // From the refounder: seeds present members.
    const honored = foldMembers(
      [snap("refounder", ["dave"], 1_000)],
      new Map(),
      new Set(),
      standing,
      10_000,
      "refounder",
    );
    expect(honored.has("dave")).toBe(true);
  });

  it("drops a snapshot's seed once its subject self-signs a newer leave", () => {
    const snap = decoded(
      {
        kind: 3312,
        content: JSON.stringify(["dave"]),
        tags: [
          ["snap", "s1", "1", "1"],
          ["ms", "0"],
        ],
      },
      "refounder",
      1_000,
    );
    const leave = decoded({ kind: 3306, content: "leave", tags: [["ms", "5"]] }, "dave", 2_000);
    const members = foldMembers([snap, leave], new Map(), new Set(), standing, 10_000, "refounder");
    expect(members.has("dave")).toBe(false);
  });

  it("drops an entry whose ms tag is out of range (malformed)", () => {
    const badJoin = decoded({ kind: 3306, content: "join", tags: [["ms", "5000"]] }, "eve", 1_000);
    const members = foldMembers([badJoin], new Map(), new Set(), standing, 10_000);
    // Observation still counts eve forward if she's seen elsewhere, so assert the
    // malformed guestbook entry alone didn't admit her.
    expect(members.has("eve")).toBe(false);
  });

  // Characterization test (Pitfall 3, 06-RESEARCH.md): a bare `observed` entry
  // with no coalesced Guestbook state (no Join/Leave/Kick/Snapshot at all) is
  // admitted by the `!c` forward-observation branch (guestbook.ts:109-111) — this
  // is the spec's OWN "auto-included even if their Join never arrived" behavior
  // (CORD-02 §5), not a bug. `foldMembers` itself stays untouched by the ROTATE-04
  // fix; epoch scoping is applied one layer up, to the `observed` map's INPUT
  // (client/sync.ts's `planeStoreKey` + community.ts's `rewireState`), so a
  // removed member's prior-epoch observed authorship never reaches this branch
  // for the new epoch in the first place.
  it("admits a bare observed entry with no coalesced guestbook state (the `!c` branch) — foldMembers is unmodified by ROTATE-04's fix", () => {
    const observed = new Map([["frank", 5_000]]);
    const members = foldMembers([], observed, new Set(), standing, 10_000);
    expect(members.has("frank")).toBe(true);
  });
});
