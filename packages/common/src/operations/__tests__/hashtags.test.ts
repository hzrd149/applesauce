import { describe, expect, it } from "vitest";
import { includeHashtags } from "../hashtags.js";
import { unixNow } from "applesauce-core/helpers";

describe("includeHashtags", () => {
  it("should include all hashtags", async () => {
    expect(
      await includeHashtags(["nostr", "growNostr"])(
        { content: "hello world", created_at: unixNow(), tags: [], kind: 1 },
        {},
      ),
    ).toEqual(
      expect.objectContaining({
        tags: [
          ["t", "nostr"],
          ["t", "grownostr"],
        ],
      }),
    );
  });
});
