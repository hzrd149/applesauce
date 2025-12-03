import { describe, expect, it } from "vitest";
import { EventFactory } from "applesauce-core/event-factory";
import { PicturePostBlueprint } from "../picture-post.js";

describe("PicturePostBlueprint", () => {
  const factory = new EventFactory();

  it("should create a simple picture post", async () => {
    expect(
      await factory.create(
        PicturePostBlueprint,
        [
          {
            sha256: "d4c2ecade68b793caf20f9189eb9ede5eacb5f2ccee0ed30ade24696f4981573",
            url: "https://files.sovbit.host/d4c2ecade68b793caf20f9189eb9ede5eacb5f2ccee0ed30ade24696f4981573",
            dimensions: "768x1024",
            type: "image/jpeg",
            blurhash: "g9FPKJ00O@$eo#xtRj_M4oM|j[oft6RjR#-=8xtlDjt7jG9ZIWMxx]IVRkV[Di?bEKnm-:M{%M",
          },
        ],
        "Orange Chicken #grownostr",
        { hashtags: ["Foodstr"] },
      ),
    ).toEqual(
      expect.objectContaining({
        content: "Orange Chicken #grownostr",
        kind: 20,
        tags: expect.arrayContaining([
          [
            "imeta",
            "url https://files.sovbit.host/d4c2ecade68b793caf20f9189eb9ede5eacb5f2ccee0ed30ade24696f4981573",
            "m image/jpeg",
            "x d4c2ecade68b793caf20f9189eb9ede5eacb5f2ccee0ed30ade24696f4981573",
            "dim 768x1024",
            "blurhash g9FPKJ00O@$eo#xtRj_M4oM|j[oft6RjR#-=8xtlDjt7jG9ZIWMxx]IVRkV[Di?bEKnm-:M{%M",
          ],
          ["x", "d4c2ecade68b793caf20f9189eb9ede5eacb5f2ccee0ed30ade24696f4981573"],
          ["m", "image/jpeg"],
          ["t", "grownostr"],
          ["t", "foodstr"],
        ]),
      }),
    );
  });
});
