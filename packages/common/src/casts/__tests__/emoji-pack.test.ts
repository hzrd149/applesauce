import { EventStore } from "applesauce-core/event-store";
import { firstValueFrom } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { castEvent } from "../cast.js";
import { EmojiPack } from "../emoji-pack.js";
import { FavoriteEmojis } from "../favorite-emojis.js";

describe("emoji pack casts", () => {
  it("reads emoji pack metadata", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const pack = store.add(
      user.event({
        kind: 30030,
        tags: [
          ["d", "animals"],
          ["title", "Animals"],
          ["description", "Animal emoji pack"],
          ["emoji", "cat", "https://cdn.example.com/cat.png"],
        ],
      }),
    )!;

    const cast = castEvent(pack, EmojiPack, store);

    expect(cast.identifier).toBe("animals");
    expect(cast.name).toBe("Animals");
    expect(cast.description).toBe("Animal emoji pack");
    expect(cast.emojis).toEqual([{ shortcode: "cat", url: "https://cdn.example.com/cat.png" }]);
  });

  it("resolves favorite emoji pack pointers into emoji pack casts", async () => {
    const user = new FakeUser();
    const store = new EventStore();
    const pack = store.add(
      user.event({
        kind: 30030,
        tags: [
          ["d", "animals"],
          ["title", "Animals"],
          ["emoji", "cat", "https://cdn.example.com/cat.png"],
        ],
      }),
    )!;
    const favorites = store.add(
      user.event({
        kind: 10030,
        tags: [
          ["emoji", "cat", "https://cdn.example.com/cat.png", `30030:${user.pubkey}:animals`],
          ["a", `30030:${user.pubkey}:animals`],
        ],
      }),
    )!;

    const cast = castEvent(favorites, FavoriteEmojis, store);
    const packs = await firstValueFrom(cast.packs$);

    expect(cast.packPointers).toEqual([
      expect.objectContaining({ kind: 30030, pubkey: user.pubkey, identifier: "animals" }),
    ]);
    expect(packs).toHaveLength(1);
    expect(packs[0]).toBeInstanceOf(EmojiPack);
    expect(packs[0].event.id).toBe(pack.id);
  });

  it("unlocks hidden favorite emoji pack pointers", async () => {
    const user = new FakeUser();
    const store = new EventStore();
    store.add(
      user.event({
        kind: 30030,
        tags: [
          ["d", "greetings"],
          ["title", "Greetings"],
        ],
      }),
    );

    const favorites = store.add(
      user.event({
        kind: 10030,
        tags: [],
        content: await user.nip44.encrypt(
          user.pubkey,
          JSON.stringify([
            ["emoji", "wave", "https://cdn.example.com/wave.png", `30030:${user.pubkey}:greetings`],
            ["a", `30030:${user.pubkey}:greetings`],
          ]),
        ),
      }),
    )!;

    const cast = castEvent(favorites, FavoriteEmojis, store);
    await cast.unlock(user);
    const hiddenPacks = await firstValueFrom(cast.hiddenPacks$);

    expect(cast.hiddenEmojis).toEqual([
      {
        shortcode: "wave",
        url: "https://cdn.example.com/wave.png",
        address: { kind: 30030, pubkey: user.pubkey, identifier: "greetings" },
      },
    ]);
    expect(cast.hiddenPackPointers).toEqual([
      expect.objectContaining({ kind: 30030, pubkey: user.pubkey, identifier: "greetings" }),
    ]);
    expect(hiddenPacks).toHaveLength(1);
    expect(hiddenPacks?.[0]).toBeInstanceOf(EmojiPack);
  });
});
