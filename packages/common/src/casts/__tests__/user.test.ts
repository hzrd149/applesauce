import { EventStore } from "applesauce-core/event-store";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures";
import { castUser } from "../user";

describe("user", () => {
  describe("references", () => {
    it("should support sync observable properties", () => {
      const signer = new FakeUser();
      const profile = signer.profile({ name: "John Doe" });
      const eventStore = new EventStore();
      eventStore.add(profile);
      const user = castUser(profile, eventStore);
      const chain = user.profile$.name;

      let name: string | undefined = "";
      chain.subscribe((n) => (name = n));

      expect(name).toBe("John Doe");
    });
  });
});
