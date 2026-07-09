import { describe, expect, it } from "vitest";
import { getEventHash, kinds, Rumor } from "../../helpers/event.js";
import { RumorStore } from "../rumor-store.js";

/** Builds a valid rumor with a correctly recomputed `id`, overriding any fields as needed */
function makeRumor(overrides?: Partial<Omit<Rumor, "id">>): Rumor {
  const rumor: Rumor = {
    kind: overrides?.kind ?? kinds.ShortTextNote,
    pubkey: overrides?.pubkey ?? "a".repeat(64),
    created_at: overrides?.created_at ?? 1,
    content: overrides?.content ?? "hello rumor",
    tags: overrides?.tags ?? [],
    id: "",
  };
  rumor.id = getEventHash(rumor);
  return rumor;
}

describe("RumorStore verification (RUMOR-03)", () => {
  it("accepts a rumor with a correct id", () => {
    const store = new RumorStore();
    const rumor = makeRumor();

    expect(store.add(rumor)).not.toBeNull();
  });

  it("rejects a rumor with an incorrect id", () => {
    const store = new RumorStore();
    const rumor = makeRumor();
    rumor.id = "0".repeat(64);

    expect(store.add(rumor)).toBeNull();
  });
});

describe("RumorStore streams (RUMOR-04)", () => {
  it("getEvent returns the stored rumor", () => {
    const store = new RumorStore();
    const rumor = makeRumor();
    store.add(rumor);

    expect(store.getEvent(rumor.id)).toEqual(rumor);
  });

  it("filters streams the stored rumor", () => {
    const store = new RumorStore();
    const rumor = makeRumor();
    store.add(rumor);

    const emitted: Rumor[] = [];
    store.filters([{ kinds: [kinds.ShortTextNote] }]).subscribe((r) => emitted.push(r));

    expect(emitted).toContainEqual(rumor);
  });

  it("timeline returns a Rumor[] containing the stored rumor", () => {
    const store = new RumorStore();
    const rumor = makeRumor();
    store.add(rumor);

    let timeline: Rumor[] = [];
    store.timeline([{ kinds: [kinds.ShortTextNote] }]).subscribe((events) => (timeline = events));

    expect(timeline).toContainEqual(rumor);
  });

  it("replaceable returns the latest replaceable rumor", () => {
    const store = new RumorStore();
    const pubkey = "b".repeat(64);
    const older = makeRumor({ kind: kinds.Metadata, pubkey, created_at: 0, content: "old" });
    const newer = makeRumor({ kind: kinds.Metadata, pubkey, created_at: 100, content: "new" });
    store.add(older);
    store.add(newer);

    let latest: Rumor | undefined;
    store.replaceable(kinds.Metadata, pubkey).subscribe((r) => (latest = r));

    expect(latest).toEqual(newer);
  });
});

describe("RumorStore kind-5 delete (RUMOR-05)", () => {
  it("removes a stored rumor when a matching kind-5 delete rumor is added", () => {
    const store = new RumorStore();
    const rumor = makeRumor();
    store.add(rumor);
    expect(store.getEvent(rumor.id)).toEqual(rumor);

    const deleteRumor = makeRumor({
      kind: kinds.EventDeletion,
      pubkey: rumor.pubkey,
      created_at: rumor.created_at + 1,
      content: "",
      tags: [["e", rumor.id]],
    });
    store.add(deleteRumor);

    expect(store.getEvent(rumor.id)).toBeUndefined();
  });
});
