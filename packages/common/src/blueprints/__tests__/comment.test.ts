import { EventFactory } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { COMMENT_KIND, CommentPointer } from "../../helpers/comment.js";
import { CommentBlueprint } from "../comment.js";

const user = new FakeUser();

describe("CommentBlueprint", () => {
  const factory = new EventFactory();

  it("should handle replying to an article", async () => {
    const article: NostrEvent = user.event({
      content: "# The case against edits...",
      kind: 30023,
      tags: [
        ["d", "ad84e3b3"],
        ["title", "The case against edits"],
        ["published_at", "1730973840"],
        ["t", "nostr"],
      ],
    });

    const comment = await factory.create(CommentBlueprint, article, "why?");

    expect(comment).toEqual(
      expect.objectContaining({
        kind: COMMENT_KIND,
        content: "why?",
        tags: [
          // Root tags
          ["A", `30023:${article.pubkey}:ad84e3b3`],
          ["E", article.id, "", article.pubkey],
          ["K", "30023"],
          ["P", article.pubkey],
          // Reply tags
          ["a", `30023:${article.pubkey}:ad84e3b3`],
          ["e", article.id, "", article.pubkey],
          ["k", "30023"],
          ["p", article.pubkey],
        ],
      }),
    );
  });

  it("should include root P and reply p tags for author", async () => {
    const parent = user.event({
      content: "Awesome",
      kind: 1111,
      tags: [
        // Root tags
        ["E", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f"],
        ["K", "1621"],
        ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
        // Reply tags
        [
          "e",
          "3bc9097ffc1c1fcd035f01ca2397099a032c2543cb121de6ab5af9b4a9d649f1",
          "wss://relay.damus.io",
          "a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d",
        ],
        ["k", "1111"],
        ["p", "a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d"],
      ],
    });

    const comment = await factory.create(CommentBlueprint, parent, "yea it is");

    expect(comment).toEqual(
      expect.objectContaining({
        content: "yea it is",
        kind: 1111,
        tags: expect.arrayContaining([
          // Root tags
          [
            "E",
            "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f",
            "",
            "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10",
          ],
          ["K", "1621"],
          ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
          // Reply tags
          ["e", parent.id, "", user.pubkey],
          ["k", "1111"],
          ["p", user.pubkey],
        ]),
      }),
    );
  });

  it("should handle commenting on an external CommentPointer", async () => {
    const externalPointer: CommentPointer = {
      type: "external",
      kind: "podcast:item:guid",
      identifier: "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f",
    };

    const comment = await factory.create(CommentBlueprint, externalPointer, "Great episode!");

    expect(comment).toEqual(
      expect.objectContaining({
        kind: COMMENT_KIND,
        content: "Great episode!",
        tags: [
          // Root tags (capitalized)
          ["I", "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f"],
          ["K", "podcast:item:guid"],
          // Reply tags (lowercase)
          ["i", "podcast:item:guid:d98d189b-dc7b-45b1-8720-d4b98690f31f"],
          ["k", "podcast:item:guid"],
        ],
      }),
    );
  });
});
