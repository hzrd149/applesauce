import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getGitCurrentStatus,
  getGitStatusAppliedPatchIds,
  getGitStatusRootId,
  getGitStatusType,
  GIT_STATUS_APPLIED_KIND,
  GIT_STATUS_CLOSED_KIND,
  GIT_STATUS_OPEN_KIND,
  isValidGitStatus,
} from "../git-status.js";

const author = new FakeUser();
const maintainer = new FakeUser();
const stranger = new FakeUser();
const root = author.event({ kind: 1621 });

function status(user: FakeUser, kind: number, created_at: number) {
  return user.event({ kind, created_at, tags: [["e", root.id, "", "root"]] });
}

describe("git status helpers", () => {
  it("parses status events", () => {
    const applied = author.event({
      kind: GIT_STATUS_APPLIED_KIND,
      tags: [
        ["e", "f".repeat(64), "", "reply"],
        ["e", root.id, "", "root"],
        ["q", "a".repeat(64)],
      ],
    });

    expect(isValidGitStatus(applied)).toBe(true);
    expect(isValidGitStatus(author.event({ kind: GIT_STATUS_OPEN_KIND }))).toBe(false);
    expect(getGitStatusType(applied)).toBe("applied");
    expect(getGitStatusRootId(applied)).toBe(root.id);
    expect(getGitStatusAppliedPatchIds(applied)).toEqual(["a".repeat(64)]);
  });

  it("defaults to open", () => {
    expect(getGitCurrentStatus(root, [])).toBe("open");
  });

  it("uses the latest status from the author or a maintainer", () => {
    const statuses = [
      status(author, GIT_STATUS_CLOSED_KIND, 10),
      status(maintainer, GIT_STATUS_APPLIED_KIND, 20),
      status(stranger, GIT_STATUS_OPEN_KIND, 30),
    ];

    expect(getGitCurrentStatus(root, statuses)).toBe("closed");
    expect(getGitCurrentStatus(root, statuses, [maintainer.pubkey])).toBe("applied");
  });
});

it("does not treat a reply-only status as targeting the original root", () => {
  const event = author.event({ kind: GIT_STATUS_APPLIED_KIND, tags: [["e", root.id, "", "reply"]] });
  expect(isValidGitStatus(event)).toBe(false);
  expect(getGitCurrentStatus(root, [event])).toBe("open");
});
