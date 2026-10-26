import type { NostrEvent } from "applesauce-core/helpers";
import { of } from "rxjs";
import { describe, expect, it } from "vitest";

import { filterSpam, NspamClassifier } from "../classifier.js";
import { NSPAM_HASH_BUCKETS } from "../features.js";
import { type NspamModel } from "../model.js";

describe("NspamClassifier", () => {
  // A single tree that flags authors with 3 or more replies in their bundle (the group_size feature)
  const model: NspamModel = {
    roots: Int32Array.of(0),
    feature: Int32Array.of(NSPAM_HASH_BUCKETS * 2 + 17),
    threshold: Float64Array.of(2.5),
    left: Int32Array.of(~0),
    right: Int32Array.of(~1),
    leafOffset: Int32Array.of(0),
    leafValue: Float64Array.of(-5, 5),
    bias: 0,
    calibX: Float64Array.of(0, 1),
    calibY: Float64Array.of(0, 1),
  };

  let id = 0;
  const reply = (pubkey: string, created_at = id): NostrEvent => ({
    id: String(id++),
    pubkey,
    kind: 1,
    created_at,
    content: "gm",
    tags: [["e", "root"]],
    sig: "",
  });

  it("scores authors once they have enough replies", () => {
    const nspam = new NspamClassifier(model);
    expect(nspam.isSpam(reply("bot"))).toBe(false);
    expect(nspam.isSpam(reply("bot"))).toBe(false);
    expect(nspam.isSpam(reply("bot"))).toBe(true);
    expect(nspam.getScore("bot")?.score).toBeGreaterThan(0.99);
  });

  it("ignores duplicate replies and keeps only the newest ten", () => {
    const nspam = new NspamClassifier(model);
    const event = reply("a");
    expect(nspam.add(event)).toBe(true);
    expect(nspam.add(event)).toBe(false);

    for (let i = 0; i < 10; i++) nspam.add(reply("b", 100 + i));
    expect(nspam.add(reply("b", 0))).toBe(false);
  });

  it("never flags events that are not kind 1 replies", () => {
    const nspam = new NspamClassifier(model);
    const note = { ...reply("c"), tags: [] };
    for (let i = 0; i < 3; i++) nspam.add(reply("c"));
    expect(nspam.isSpam(note)).toBe(false);
    expect(() => nspam.score([note])).toThrow();
  });

  it("filters spam replies out of a timeline using every reply as evidence", () => {
    const nspam = new NspamClassifier(model);
    const timeline = [reply("bot"), reply("human"), reply("bot"), reply("bot")];
    let result: NostrEvent[] = [];
    of(timeline)
      .pipe(filterSpam(nspam))
      .subscribe((events) => (result = events));
    expect(result.map((e) => e.pubkey)).toEqual(["human"]);
  });
});
