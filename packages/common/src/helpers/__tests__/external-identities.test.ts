import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  EXTERNAL_IDENTITIES_KIND,
  getExternalIdentities,
  getExternalIdentityProofUrl,
  isValidExternalIdentities,
} from "../external-identities.js";

const user = new FakeUser();

describe("external identities helpers", () => {
  it("validates identity lists", () => {
    expect(isValidExternalIdentities(user.event({ kind: EXTERNAL_IDENTITIES_KIND }))).toBe(true);
    expect(isValidExternalIdentities(user.event({ kind: 0 }))).toBe(false);
  });

  it("parses identities and skips invalid tags", () => {
    const event = user.event({
      kind: EXTERNAL_IDENTITIES_KIND,
      tags: [
        ["i", "github:semisol", "9721ce4ee4fceb91c9711ca2a6c9a5ab"],
        ["i", "mastodon:bitcoinhackers.org/@semisol", "109775066355589974"],
        ["i", "github:missing-proof"],
        ["i", "no-platform", "proof"],
        ["t", "github:not-an-i-tag", "proof"],
      ],
    });

    expect(getExternalIdentities(event)).toEqual([
      { platform: "github", identity: "semisol", proof: "9721ce4ee4fceb91c9711ca2a6c9a5ab" },
      { platform: "mastodon", identity: "bitcoinhackers.org/@semisol", proof: "109775066355589974" },
    ]);
  });

  it("builds proof urls for known platforms", () => {
    expect(getExternalIdentityProofUrl({ platform: "github", identity: "semisol", proof: "abc" })).toBe(
      "https://gist.github.com/semisol/abc",
    );
    expect(
      getExternalIdentityProofUrl({ platform: "mastodon", identity: "bitcoinhackers.org/@semisol", proof: "123" }),
    ).toBe("https://bitcoinhackers.org/@semisol/123");
    expect(
      getExternalIdentityProofUrl({ platform: "telegram", identity: "1087295469", proof: "nostrdirectory/770" }),
    ).toBe("https://t.me/nostrdirectory/770");
    expect(getExternalIdentityProofUrl({ platform: "unknown", identity: "a", proof: "b" })).toBeUndefined();
  });
});
