import { describe, expect, it } from "vitest";
import { createEvent } from "applesauce-core/event-factory";
import { ProfileBlueprint } from "../profile.js";

describe("ProfileBlueprint", () => {
  it("should create a kind 0 profile event", async () => {
    const profile = await createEvent(
      {},
      ProfileBlueprint({
        name: "alice",
        display_name: "Alice",
        about: "A test user profile",
        picture: "https://example.com/avatar.png",
      }),
    );

    expect(profile.kind).toBe(0);
    expect(profile.content).toBe(
      JSON.stringify({
        name: "alice",
        display_name: "Alice",
        about: "A test user profile",
        picture: "https://example.com/avatar.png",
      }),
    );
    expect(profile.tags).toEqual([]);
  });

  it("should create a profile with all optional fields", async () => {
    const profile = await createEvent(
      {},
      ProfileBlueprint({
        name: "bob",
        display_name: "Bob Builder",
        about: "Can we fix it? Yes we can!",
        picture: "https://example.com/bob.jpg",
        banner: "https://example.com/banner.jpg",
        website: "https://bob.builder.com",
        lud16: "bob@getalby.com",
        nip05: "bob@bob.builder.com",
      }),
    );

    expect(profile.kind).toBe(0);
    const content = JSON.parse(profile.content);
    expect(content.name).toBe("bob");
    expect(content.display_name).toBe("Bob Builder");
    expect(content.about).toBe("Can we fix it? Yes we can!");
    expect(content.picture).toBe("https://example.com/bob.jpg");
    expect(content.banner).toBe("https://example.com/banner.jpg");
    expect(content.website).toBe("https://bob.builder.com");
    expect(content.lud16).toBe("bob@getalby.com");
    expect(content.nip05).toBe("bob@bob.builder.com");
  });

  it("should create a minimal profile with just a name", async () => {
    const profile = await createEvent({}, ProfileBlueprint({ name: "charlie" }));

    expect(profile.kind).toBe(0);
    expect(profile.content).toBe(JSON.stringify({ name: "charlie" }));
  });

  it("should create a profile with empty object", async () => {
    const profile = await createEvent({}, ProfileBlueprint({}));

    expect(profile.kind).toBe(0);
    expect(profile.content).toBe(JSON.stringify({}));
  });
});
