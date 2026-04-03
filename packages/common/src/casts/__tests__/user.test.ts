import { EventStore } from "applesauce-core/event-store";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures";
import { castUser } from "../user";
import { firstValueFrom } from "rxjs";

describe("user", () => {
  describe("references", () => {
    it("should support sync observable properties", async () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const eventStore = new EventStore();
      eventStore.add(profile);

      const user = castUser(profile, eventStore);

      // Subscribe once to load the circular dependency
      await firstValueFrom(user.profile$.name);

      const chain = user.profile$.name;

      let name: string | undefined = "";
      chain.subscribe((n) => (name = n));

      expect(name).toBe("John Doe");
    });

    it("should resolve favorite emoji packs", async () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const favorites = signer.event({
        kind: 10030,
        tags: [["a", `30030:${signer.pubkey}:animals`]],
      });
      const eventStore = new EventStore();
      eventStore.add(profile);
      eventStore.add(favorites);

      const user = castUser(profile, eventStore);
      const favoriteEmojiPacks = await firstValueFrom(user.favoriteEmojis$);

      expect(favoriteEmojiPacks?.packPointers).toEqual([
        expect.objectContaining({ kind: 30030, pubkey: signer.pubkey, identifier: "animals" }),
      ]);
    });
  });
});
