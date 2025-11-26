import { describe, expect, it } from "vitest";
import { getHiddenTags } from "applesauce-core/helpers";

import { EventFactory } from "applesauce-core/event-factory";
import { FollowSetBlueprint } from "../follow-set.js";
import { FakeUser } from "../../__tests__/fixtures.js";

describe("FollowSetBlueprint", () => {
  const user = new FakeUser();
  const factory = new EventFactory({ signer: user });
  const alice = new FakeUser();
  const bob = new FakeUser();
  const carol = new FakeUser();

  it("should create a follow set with title, description and image", async () => {
    const event = await factory.create(FollowSetBlueprint, {
      title: "My Friends",
      description: "A list of my friends",
      image: "https://example.com/image.jpg",
    });

    expect(event).toEqual(
      expect.objectContaining({
        kind: 30000,
        tags: expect.arrayContaining([
          ["title", "My Friends"],
          ["description", "A list of my friends"],
          ["image", "https://example.com/image.jpg"],
        ]),
      }),
    );
  });

  it("should create a follow set with public profile pointers", async () => {
    const event = await factory.create(FollowSetBlueprint, {}, [{ pubkey: alice.pubkey }, { pubkey: bob.pubkey }]);

    expect(event).toEqual(
      expect.objectContaining({
        kind: 30000,
        tags: expect.arrayContaining([
          ["p", alice.pubkey],
          ["p", bob.pubkey],
        ]),
      }),
    );
  });

  it("should create a follow set with public and hidden profile pointers", async () => {
    const event = await factory.create(
      FollowSetBlueprint,
      {},
      {
        public: [{ pubkey: alice.pubkey }],
        hidden: [{ pubkey: bob.pubkey }, { pubkey: carol.pubkey }],
      },
    );

    expect(event).toEqual(
      expect.objectContaining({
        kind: 30000,
        tags: expect.arrayContaining([["p", alice.pubkey]]),
      }),
    );

    // Hidden tags should be in encrypted form
    expect(getHiddenTags(event)).toEqual(
      expect.arrayContaining([
        ["p", bob.pubkey],
        ["p", carol.pubkey],
      ]),
    );
  });
});
