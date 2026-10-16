import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { castEvent } from "../cast.js";
import { castUser } from "../user.js";
import { UserStatus } from "../user-status.js";

const user = new FakeUser();
const friend = new FakeUser();

describe("UserStatus cast", () => {
  it("reads the status fields", () => {
    const store = new EventStore();
    const event = store.add(
      user.event({
        kind: 30315,
        content: "Intergalatic - Beastie Boys",
        tags: [
          ["d", "music"],
          ["r", "spotify:search:Intergalatic"],
          ["expiration", "4000000000"],
        ],
      }),
    )!;

    const status = castEvent(event, UserStatus, store);
    expect(status.type).toBe("music");
    expect(status.content).toBe("Intergalatic - Beastie Boys");
    expect(status.cleared).toBe(false);
    expect(status.expiration).toBe(4000000000);
    expect(status.url).toBe("spotify:search:Intergalatic");
  });

  it("casts a linked profile to a user", () => {
    const store = new EventStore();
    const event = store.add(
      user.event({
        kind: 30315,
        content: "Talking to",
        tags: [
          ["d", "general"],
          ["p", friend.pubkey],
        ],
      }),
    )!;
    expect(castEvent(event, UserStatus, store).user?.pubkey).toBe(friend.pubkey);
  });

  it("resolves a linked event", async () => {
    const store = new EventStore();
    const note = store.add(friend.note("Join the nest"))!;
    const event = store.add(
      user.event({
        kind: 30315,
        content: "In a nest",
        tags: [
          ["d", "general"],
          ["e", note.id],
        ],
      }),
    )!;
    expect(await firstValueFrom(castEvent(event, UserStatus, store).linkedEvent$)).toBe(note);
  });

  it("throws for invalid events", () => {
    const store = new EventStore();
    expect(() => castEvent(user.event({ kind: 1 }), UserStatus, store)).toThrow();
  });

  it("adds status$ and statuses$ to the user cast", async () => {
    const store = new EventStore();
    store.add(user.event({ kind: 30315, content: "Hiking", tags: [["d", "general"]] }));
    store.add(user.event({ kind: 30315, content: "", tags: [["d", "music"]] }));

    const cast = castUser(user.pubkey, store);
    expect((await firstValueFrom(cast.status$))?.content).toBe("Hiking");
    expect((await firstValueFrom(cast.statuses$)).map((s) => s.type)).toEqual(["general"]);
  });
});
