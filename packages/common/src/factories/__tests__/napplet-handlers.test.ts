import { getHiddenTags, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { getNappletHandlerCandidates, unlockHiddenNappletHandlers } from "../../helpers/napplet-handlers.js";
import { NappletHandlersFactory } from "../napplet-handlers.js";

const user = new FakeUser();
const dev = new FakeUser();
const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";
const EDITOR = `35129:${dev.pubkey}:editor`;
const VIEWER = `35129:${dev.pubkey}:viewer`;

describe("NappletHandlersFactory", () => {
  it("creates preferences for an archetype", async () => {
    const draft = await NappletHandlersFactory.create("profile").handler(VIEWER).preferHandler(EDITOR);

    expect(draft.kind).toBe(31129);
    expect(draft.tags).toEqual([
      ["d", "profile"],
      ["a", EDITOR],
      ["a", VIEWER],
    ]);
  });

  it("expands bare intent names with the archetype", async () => {
    const draft = await NappletHandlersFactory.create("profile")
      .intentHandler("edit", VIEWER)
      .preferIntentHandler("napplet:profile/edit", EDITOR);

    expect(draft.tags).toEqual([
      ["d", "profile"],
      ["i", "napplet:profile/edit", EDITOR],
      ["i", "napplet:profile/edit", VIEWER],
    ]);
  });

  it("throws on an intent for another archetype", async () => {
    await expect(NappletHandlersFactory.create("profile").intentHandler("napplet:feed/edit", EDITOR)).rejects.toThrow();
  });

  it("modifies existing preferences", async () => {
    const existing = user.event({
      kind: 31129,
      tags: [
        ["d", "profile"],
        ["a", VIEWER],
        ["i", "napplet:profile/edit", VIEWER],
      ],
    });
    const draft = await NappletHandlersFactory.modify(existing).removeHandler(VIEWER).removeIntentHandler("edit");

    expect(draft.tags).toEqual([["d", "profile"]]);
  });

  it("throws when modifying another kind", () => {
    expect(() => NappletHandlersFactory.modify(user.note())).toThrow();
  });

  it("stores private entries encrypted to the author", async () => {
    const snapshot = dev.event({ kind: 5129, content: "x", tags: [["x", HASH]] });
    const event = await NappletHandlersFactory.create("profile")
      .as(user)
      .handler(VIEWER)
      .preferHandler(snapshot, true)
      .intentHandler("edit", EDITOR, true)
      .sign();

    expect(event.tags).toEqual([
      ["d", "profile"],
      ["a", VIEWER],
    ]);
    await unlockHiddenTags(event, user);
    expect(getHiddenTags(event)).toEqual([
      ["e", snapshot.id, "", dev.pubkey],
      ["i", "napplet:profile/edit", EDITOR],
    ]);
  });

  it("resolves the private intent handler first", async () => {
    const snapshot = dev.event({ kind: 5129, content: "x", tags: [["x", HASH]] });
    const event = await NappletHandlersFactory.create("profile")
      .preferHandler(snapshot)
      .intentHandler("edit", EDITOR, true)
      .sign(user);
    await unlockHiddenNappletHandlers(event, user);

    const candidates = getNappletHandlerCandidates(event, "napplet:profile/edit");
    expect(candidates.map((c) => [c.hidden, c.intent])).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(candidates[0].ref.pointer).toEqual({ kind: 35129, pubkey: dev.pubkey, identifier: "editor" });
  });

  it("clears every entry", async () => {
    const existing = await NappletHandlersFactory.create("profile").handler(VIEWER).handler(EDITOR, true).sign(user);
    const draft = await NappletHandlersFactory.modify(existing).clear();

    expect(draft.tags).toEqual([["d", "profile"]]);
    expect(draft.content).toBe("");
  });
});
