import { naddrEncode, neventEncode } from "applesauce-core/helpers/pointers";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  addNappletHandlerTag,
  addNappletIntentHandlerTag,
  clearNappletHandlerTags,
  createNappletHandlerTag,
  preferNappletHandlerTag,
  preferNappletIntentHandlerTag,
  removeNappletHandlerTag,
  removeNappletIntentHandlerTag,
} from "../napplet-handlers.js";

const dev = new FakeUser();
const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";
const EDITOR = `35129:${dev.pubkey}:editor`;
const VIEWER = `35129:${dev.pubkey}:viewer`;
const ROOT = `15129:${dev.pubkey}:`;
const SNAPSHOT = "5".repeat(64);
const EDIT = "napplet:profile/edit";

describe("createNappletHandlerTag", () => {
  it("creates tags from coordinates, ids and NIP-19 strings", () => {
    expect(createNappletHandlerTag(EDITOR)).toEqual(["a", EDITOR]);
    expect(createNappletHandlerTag(ROOT)).toEqual(["a", ROOT]);
    expect(createNappletHandlerTag(SNAPSHOT)).toEqual(["e", SNAPSHOT]);
    expect(
      createNappletHandlerTag(
        naddrEncode({ kind: 35129, pubkey: dev.pubkey, identifier: "editor", relays: ["wss://relay.example.com"] }),
      ),
    ).toEqual(["a", EDITOR, "wss://relay.example.com/"]);
    expect(createNappletHandlerTag(neventEncode({ id: SNAPSHOT, author: dev.pubkey }))).toEqual([
      "e",
      SNAPSHOT,
      "",
      dev.pubkey,
    ]);
  });

  it("creates tags from manifest events", () => {
    const named = dev.event({
      kind: 35129,
      content: "x",
      tags: [
        ["d", "editor"],
        ["x", HASH],
      ],
    });
    const snapshot = dev.event({ kind: 5129, content: "x", tags: [["x", HASH]] });

    expect(createNappletHandlerTag(named)).toEqual(["a", EDITOR]);
    expect(createNappletHandlerTag(snapshot)).toEqual(["e", snapshot.id, "", dev.pubkey]);
  });

  it("refuses to pin replaceable manifests or reference other kinds", () => {
    expect(() => createNappletHandlerTag({ id: SNAPSHOT, kind: 35129 })).toThrow();
    expect(() => createNappletHandlerTag(`30023:${dev.pubkey}:article`)).toThrow();
    expect(() => createNappletHandlerTag(`35129:${dev.pubkey}:`)).toThrow();
    expect(() => createNappletHandlerTag(dev.note())).toThrow();
    expect(() => createNappletHandlerTag("nonsense")).toThrow();
  });
});

describe("archetype-wide handler operations", () => {
  const tags = [["d", "profile"], ["a", VIEWER], ["i", EDIT, VIEWER], ["e", SNAPSHOT], ["unknown"]];

  it("appends a fallback and updates an existing hint in place", async () => {
    expect(await addNappletHandlerTag(EDITOR)(tags)).toEqual([...tags, ["a", EDITOR]]);
    expect(
      await addNappletHandlerTag({ kind: 35129, pubkey: dev.pubkey, identifier: "viewer", relays: ["wss://r.com"] })(
        tags,
      ),
    ).toEqual([["d", "profile"], ["a", VIEWER, "wss://r.com/"], ["i", EDIT, VIEWER], ["e", SNAPSHOT], ["unknown"]]);
  });

  it("moves or inserts a preferred handler to the front", async () => {
    expect(await preferNappletHandlerTag(SNAPSHOT)(tags)).toEqual([
      ["d", "profile"],
      ["e", SNAPSHOT],
      ["a", VIEWER],
      ["i", EDIT, VIEWER],
      ["unknown"],
    ]);
    expect(await preferNappletHandlerTag(EDITOR)([["d", "profile"]])).toEqual([
      ["d", "profile"],
      ["a", EDITOR],
    ]);
  });

  it("removes a handler and keeps other tags", async () => {
    expect(await removeNappletHandlerTag(VIEWER)(tags)).toEqual([
      ["d", "profile"],
      ["i", EDIT, VIEWER],
      ["e", SNAPSHOT],
      ["unknown"],
    ]);
  });

  it("clears every entry and keeps the d tag and unknown tags", async () => {
    expect(await clearNappletHandlerTags()(tags)).toEqual([["d", "profile"], ["unknown"]]);
  });
});

describe("intent handler operations", () => {
  const tags = [
    ["d", "profile"],
    ["i", EDIT, VIEWER],
    ["i", "napplet:profile/view", VIEWER],
  ];

  it("appends a fallback once", async () => {
    const added = await addNappletIntentHandlerTag(EDIT, EDITOR)(tags);
    expect(added).toEqual([...tags, ["i", EDIT, EDITOR]]);
    expect(await addNappletIntentHandlerTag(EDIT, EDITOR)(added)).toEqual(added);
  });

  it("uses a bare reference without relay hints", async () => {
    const pointer = { kind: 35129, pubkey: dev.pubkey, identifier: "editor", relays: ["wss://r.com"] };
    expect(await addNappletIntentHandlerTag(EDIT, pointer)([])).toEqual([["i", EDIT, EDITOR]]);
  });

  it("moves a preferred handler before others for the same identity", async () => {
    expect(await preferNappletIntentHandlerTag(EDIT, ROOT)(tags)).toEqual([
      ["d", "profile"],
      ["i", EDIT, ROOT],
      ["i", EDIT, VIEWER],
      ["i", "napplet:profile/view", VIEWER],
    ]);
  });

  it("removes one or all handlers for an identity", async () => {
    const more = [...tags, ["i", EDIT, EDITOR]];
    expect(await removeNappletIntentHandlerTag(EDIT, VIEWER)(more)).toEqual([
      ["d", "profile"],
      ["i", "napplet:profile/view", VIEWER],
      ["i", EDIT, EDITOR],
    ]);
    expect(await removeNappletIntentHandlerTag(EDIT)(more)).toEqual([
      ["d", "profile"],
      ["i", "napplet:profile/view", VIEWER],
    ]);
  });

  it("throws on identities with a query or fragment", () => {
    expect(() => addNappletIntentHandlerTag("napplet:profile/edit?x=1", EDITOR)).toThrow();
    expect(() => preferNappletIntentHandlerTag("napplet:profile/edit#a", EDITOR)).toThrow();
  });
});
