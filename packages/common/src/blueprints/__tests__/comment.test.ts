import { EventFactory } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { COMMENT_KIND } from "../../helpers/comment.js";
import { CommentBlueprint } from "../comment.js";

describe("CommentBlueprint", () => {
  const factory = new EventFactory();

  it("should handle replying to an article", async () => {
    const article: NostrEvent = {
      content: "# The case against edits...",
      created_at: 1730991377,
      id: "caa65d8b3b11d887da7188f3fe75c33d7be80d3df8c46f241a275b9075888674",
      kind: 30023,
      pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      sig: "eb30514d222b3ed83a2b3addd8242abe039d88f43330f1f06a1efba8840ea46ce687f60d582237f28bb88845a65de421d25bdda7eb2cb3d3c125b986722c230b",
      tags: [
        ["d", "ad84e3b3"],
        ["title", "The case against edits"],
        ["published_at", "1730973840"],
        ["t", "nostr"],
      ],
    };

    expect(await factory.create(CommentBlueprint, article, "why?")).toEqual(
      expect.objectContaining({
        kind: COMMENT_KIND,
        content: "why?",
        tags: [
          ["A", "30023:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:ad84e3b3"],
          [
            "E",
            "caa65d8b3b11d887da7188f3fe75c33d7be80d3df8c46f241a275b9075888674",
            "",
            "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
          ],
          ["K", "30023"],
          ["P", "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"],
          ["a", "30023:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:ad84e3b3"],
          [
            "e",
            "caa65d8b3b11d887da7188f3fe75c33d7be80d3df8c46f241a275b9075888674",
            "",
            "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
          ],
          ["k", "30023"],
          ["p", "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"],
        ],
      }),
    );
  });

  it("should include root P and reply p tags for author", async () => {
    const parent: NostrEvent = {
      content: "Awesome",
      created_at: 1740149695,
      id: "parent-event-id",
      kind: 1111,
      pubkey: "pubkey",
      sig: "sig",
      tags: [
        ["E", "86c0b95589b016ffb703bfc080d49e54106e74e2d683295119c3453e494dbe6f"],
        ["K", "1621"],
        ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
        [
          "e",
          "3bc9097ffc1c1fcd035f01ca2397099a032c2543cb121de6ab5af9b4a9d649f1",
          "wss://relay.damus.io",
          "a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d",
        ],
        ["k", "1111"],
        ["p", "a008def15796fba9a0d6fab04e8fd57089285d9fd505da5a83fe8aad57a3564d"],
      ],
    };

    expect(await factory.create(CommentBlueprint, parent, "yea it is")).toEqual(
      expect.objectContaining({
        content: "yea it is",
        tags: expect.arrayContaining([
          ["P", "e4336cd525df79fa4d3af364fd9600d4b10dce4215aa4c33ed77ea0842344b10"],
          ["p", "pubkey"],
        ]),
      }),
    );
  });
});
