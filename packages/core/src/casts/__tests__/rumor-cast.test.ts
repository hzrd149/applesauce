import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import type { Rumor } from "../../helpers/event.js";
import { castEvent } from "../cast.js";
import { EventCast } from "../event.js";

// A minimal cast parameterized on an unsigned Rumor — the shape the store-migration plan calls
// out as the goal of genericizing the cast subsystem.
class RumorNote extends EventCast<Rumor> {
  get text() {
    return this.event.content;
  }
}

/** A sig-less rumor with a valid id (a signed event minus its signature). */
function makeRumor(overrides?: { kind?: number; content?: string }): { rumor: Rumor; pubkey: string; id: string } {
  const user = new FakeUser();
  const signed = user.event({ kind: overrides?.kind ?? 1, content: overrides?.content ?? "" });
  const rumor = { ...signed } as Rumor & { sig?: string };
  delete rumor.sig; // id is computed without sig, so it stays valid
  return { rumor, pubkey: user.pubkey, id: signed.id };
}

describe("EventCast over a rumor", () => {
  it("casts an unsigned rumor via castEvent and reads its fields", () => {
    const { rumor, pubkey, id } = makeRumor({ content: "hello rumor" });
    const cast = castEvent(rumor, RumorNote, new EventStore());

    expect(cast).toBeInstanceOf(RumorNote);
    expect(cast.text).toBe("hello rumor");
    expect(cast.id).toBe(id);
    expect(cast.kind).toBe(1);
    // The inherited `author` accessor resolves a rumor correctly (no `sig` required).
    expect(cast.author.pubkey).toBe(pubkey);
  });

  it("memoizes the cast instance on the rumor", () => {
    const { rumor } = makeRumor();
    const store = new EventStore();
    expect(castEvent(rumor, RumorNote, store)).toBe(castEvent(rumor, RumorNote, store));
  });
});
