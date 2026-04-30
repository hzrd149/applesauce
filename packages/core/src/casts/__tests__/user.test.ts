import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import { EventCast } from "../cast.js";
import { castUser, User } from "../user.js";

class KindOneCast extends EventCast {
  constructor(event: any, store: any) {
    if (event.kind !== 1) throw new Error("Invalid kind");
    super(event, store);
  }
}

describe("User", () => {
  beforeEach(() => {
    User.cache.clear();
  });

  describe("timeline$", () => {
    it("should normalize a kind number and scope timeline to this author", () => {
      const signer = new FakeUser();
      const other = new FakeUser();
      const store = new EventStore();
      const timelineSpy = vi.spyOn(store, "timeline");

      const ownKindOne = signer.event({ kind: 1 });
      store.add(ownKindOne);
      store.add(signer.event({ kind: 0 }));
      store.add(other.event({ kind: 1 }));

      const user = castUser(signer.pubkey, store);
      const spy = subscribeSpyTo(user.timeline$(1));

      expect(timelineSpy).toHaveBeenCalledWith([{ kinds: [1], authors: [signer.pubkey] }]);
      expect(spy.getValues().at(-1)).toEqual([ownKindOne]);
    });

    it("should normalize kind arrays and inject authors into each filter", () => {
      const signer = new FakeUser();
      const store = new EventStore();
      const timelineSpy = vi.spyOn(store, "timeline");
      const user = castUser(signer.pubkey, store);

      user.timeline$([1, 30023]);

      expect(timelineSpy).toHaveBeenCalledWith([
        { kinds: [1], authors: [signer.pubkey] },
        { kinds: [30023], authors: [signer.pubkey] },
      ]);
    });

    it("should cache timeline observables for identical filter input", () => {
      const signer = new FakeUser();
      const store = new EventStore();
      const timelineSpy = vi.spyOn(store, "timeline");
      const user = castUser(signer.pubkey, store);

      const first = user.timeline$({ kinds: [1] });
      const second = user.timeline$({ kinds: [1] });

      expect(first).toBe(second);
      expect(timelineSpy).toHaveBeenCalledTimes(1);
      expect(timelineSpy).toHaveBeenCalledWith([{ kinds: [1], authors: [signer.pubkey] }]);
    });

    it("should cast timeline events when a cast class is provided", () => {
      const signer = new FakeUser();
      const store = new EventStore();
      const user = castUser(signer.pubkey, store);

      store.add(signer.event({ kind: 0 }));
      const kindOneA = signer.event({ kind: 1, content: "first" });
      const kindOneB = signer.event({ kind: 1, content: "second" });
      store.add(kindOneA);
      store.add(kindOneB);

      const spy = subscribeSpyTo(user.timeline$([0, 1], KindOneCast));
      const values = spy.getValues().at(-1)!;

      expect(values).toHaveLength(2);
      expect(values.every((event) => event instanceof KindOneCast)).toBe(true);
      expect(values.map((event) => event.id)).toEqual([kindOneB.id, kindOneA.id]);
    });
  });
});
