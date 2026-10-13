import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { Profile } from "../profile.js";

const user = new FakeUser();
const store = {} as any;

describe("Profile", () => {
  it("returns imeta metadata for the picture and banner", () => {
    const event = user.event({
      kind: 0,
      content: JSON.stringify({ picture: "https://a.example/p.png", banner: "https://a.example/b.png" }),
      tags: [
        ["imeta", "url https://a.example/b.png", "dim 1024x768", "blurhash abc"],
        ["imeta", "url https://a.example/p.png", "m image/png"],
      ],
    });
    const profile = new Profile(event, store);

    expect(profile.bannerMetadata).toEqual(
      expect.objectContaining({ url: "https://a.example/b.png", dimensions: "1024x768", blurhash: "abc" }),
    );
    expect(profile.pictureMetadata).toEqual(expect.objectContaining({ type: "image/png" }));
  });

  it("returns undefined imeta metadata when missing", () => {
    const profile = new Profile(user.event({ kind: 0, content: JSON.stringify({ banner: "https://x/b.png" }) }), store);
    expect(profile.bannerMetadata).toBeUndefined();
    expect(profile.pictureMetadata).toBeUndefined();
  });

  it("returns lowercase hashtags", () => {
    const event = user.event({
      kind: 0,
      content: "{}",
      tags: [
        ["t", "Nostr"],
        ["t", "bitcoin"],
      ],
    });
    expect(new Profile(event, store).hashtags).toEqual(["nostr", "bitcoin"]);
  });
});
