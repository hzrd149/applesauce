import { describe, expect, it } from "vitest";
import * as factories from "../index.js";

describe("manifest factory exports", () => {
  it("exports one concrete factory per kind", () => {
    expect(
      Object.keys(factories)
        .filter((name) => /Nsite|Napplet/.test(name))
        .sort(),
    ).toMatchInlineSnapshot(`
      [
        "NamedNappletFactory",
        "NamedNsiteFactory",
        "NappletSnapshotFactory",
        "NsiteSnapshotFactory",
        "RootNappletFactory",
        "RootNsiteFactory",
      ]
    `);
  });
});

describe("Git factory exports", () => {
  it("exports one factory per thread and status kind without internal bases", () => {
    expect(
      Object.keys(factories)
        .filter((name) => /^Git.*(?:Issue|Patch|PullRequest|Status).*Factory$/.test(name))
        .sort(),
    ).toEqual([
      "GitAppliedStatusFactory",
      "GitClosedStatusFactory",
      "GitDraftStatusFactory",
      "GitIssueFactory",
      "GitOpenStatusFactory",
      "GitPatchFactory",
      "GitPullRequestFactory",
      "GitPullRequestUpdateFactory",
    ]);
    expect(Object.keys(factories)).not.toContain("GitThreadFactory");
    expect(Object.keys(factories)).not.toContain("GitPullRequestFetchFactory");
    expect(Object.keys(factories)).not.toContain("GitStatusTargetFactory");
    expect(Object.keys(factories)).not.toContain("GitStatusFactory");
  });
});
