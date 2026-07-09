import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import { RumorStore } from "../../event-store/rumor-store.js";
import type { NostrEvent, Rumor } from "../../helpers/event.js";
import type { CastRefEventStore } from "../cast.js";
import { castEvent } from "../cast.js";
import { EventCast } from "../event.js";

// A minimal cast parameterized on an unsigned Rumor — the shape the store-migration plan calls
// out as the goal of genericizing the cast subsystem.
class RumorNote extends EventCast<Rumor> {
  get text() {
    return this.event.content;
  }
}

// A signed-only cast (reads `event.sig`) used below as a WR-01 regression guard: a rumor must be
// rejected at compile time when passed to a cast whose declared event type requires a signature.
class SignedOnlyCast extends EventCast<NostrEvent> {
  get signature() {
    return this.event.sig;
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

  it("casts an unsigned rumor via castEvent against a real RumorStore (RUMOR-06)", () => {
    const { rumor, id } = makeRumor({ content: "hello rumor store" });
    const rumorStore = new RumorStore();
    rumorStore.add(rumor);

    // Bridge cast: RumorNote's inherited EventCast constructor's `store` param is hardcoded to
    // bare CastRefEventStore (invariant in E); a genuine RumorStore (EventStore<Rumor>) is not
    // structurally assignable to it. This mirrors the `signedView` bridge already used in
    // casts/event.ts (lines 27-29) — see RESEARCH.md Pattern 3 for why parameterizing
    // EventCast's `store` field instead would ripple into user.ts and is out of scope here.
    const cast = castEvent(rumor, RumorNote, rumorStore as unknown as CastRefEventStore);

    expect(cast).toBeInstanceOf(RumorNote);
    expect(cast.text).toBe("hello rumor store");
    expect(cast.id).toBe(id);
  });

  it("rejects a rumor for a signed-only cast at compile time (WR-01 regression guard)", () => {
    const { rumor } = makeRumor();
    const store = new EventStore();

    // A signed-only cast's declared event type requires `sig`, so CastEventInput<T> pins the
    // input to NostrEvent — a rumor (no `sig`) must fail to type-check here. If the sig-gate
    // ever regresses, this line stops erroring and `@ts-expect-error` fails the build.
    // @ts-expect-error - a rumor (sig-less) is not assignable to a signed-only cast's input
    castEvent(rumor, SignedOnlyCast, store);
  });
});
