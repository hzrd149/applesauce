import { describe, expect, it } from "vitest";

import type { Role } from "../../types.js";
import { foldMembers } from "../guestbook.js";
import { resolveStanding } from "../permissions.js";
import { decoded } from "./test-utils.js";

describe("guestbook fold", () => {
  it("coalesces joins/leaves, honors banlist", () => {
    const join = (pk: string, ms: number) => decoded({ kind: 3306, content: "join", tags: [["ms", String(ms % 1000)]] }, pk, ms);
    const leave = (pk: string, ms: number) => decoded({ kind: 3306, content: "leave", tags: [["ms", String(ms % 1000)]] }, pk, ms);
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
});
