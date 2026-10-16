import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { clearStatusLink, setStatusLink, setStatusType } from "../user-status.js";

const friend = new FakeUser();

function draft(tags: string[][] = []): EventTemplate {
  return { kind: 30315, content: "", tags, created_at: unixNow() };
}

describe("user status operations", () => {
  it("sets the status type", async () => {
    const result = await setStatusType("music")(draft([["d", "general"]]));
    expect(result.tags).toEqual([["d", "music"]]);
  });

  it("replaces existing links with a single link", async () => {
    const result = await setStatusLink({ type: "nprofile", data: { pubkey: friend.pubkey } })(
      draft([
        ["d", "general"],
        ["r", "https://nostr.world"],
      ]),
    );
    expect(result.tags).toEqual([
      ["d", "general"],
      ["p", friend.pubkey],
    ]);
  });

  it("treats a string as a url", async () => {
    const result = await setStatusLink("https://nostr.world")(draft());
    expect(result.tags).toEqual([["r", "https://nostr.world"]]);
  });

  it("clears links", async () => {
    const result = await clearStatusLink()(
      draft([
        ["d", "general"],
        ["e", "a".repeat(64)],
      ]),
    );
    expect(result.tags).toEqual([["d", "general"]]);
  });
});
