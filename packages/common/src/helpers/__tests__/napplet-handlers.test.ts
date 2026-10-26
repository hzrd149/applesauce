import { setHiddenTagsCache } from "applesauce-core/helpers/hidden-tags";
import { nip44 } from "applesauce-core/helpers/encryption";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getHiddenNappletHandlers,
  getNappletHandlerCandidates,
  getNappletHandlersArchetype,
  getNappletHandlersFilter,
  getPublicNappletHandlers,
  isHiddenNappletHandlersUnlocked,
  isSameNappletHandlerRef,
  isValidNappletHandlers,
  NAPPLET_HANDLERS_KIND,
  parseNappletHandlerRef,
  unlockHiddenNappletHandlers,
} from "../napplet-handlers.js";

const user = new FakeUser();
const dev = "d".repeat(64);
const SNAPSHOT = "5".repeat(64);
const PINNED = "6".repeat(64);
const EDITOR = `35129:${dev}:editor`;
const VIEWER = `35129:${dev}:viewer`;
const ROOT = `15129:${dev}:`;

function preferences(tags: string[][], content = "") {
  return user.event({ kind: NAPPLET_HANDLERS_KIND, content, tags: [["d", "profile"], ...tags] });
}

async function withHidden(tags: string[][], hidden: string[][]) {
  const key = nip44.getConversationKey(user.key, user.pubkey);
  const content = nip44.encrypt(JSON.stringify(hidden), key);
  return preferences(tags, content);
}

describe("napplet handler preference helpers", () => {
  it("validates the kind and archetype", () => {
    expect(isValidNappletHandlers(preferences([]))).toBe(true);
    expect(isValidNappletHandlers(user.event({ kind: NAPPLET_HANDLERS_KIND, tags: [] }))).toBe(false);
    expect(isValidNappletHandlers(user.note())).toBe(false);
    expect(getNappletHandlersArchetype(preferences([]))).toBe("profile");
  });

  it("builds a filter for an archetype", () => {
    expect(getNappletHandlersFilter("profile", [user.pubkey])).toEqual({
      kinds: [NAPPLET_HANDLERS_KIND],
      "#d": ["profile"],
      authors: [user.pubkey],
    });
  });

  it("parses references", () => {
    expect(parseNappletHandlerRef(EDITOR)).toEqual({
      type: "address",
      pointer: { kind: 35129, pubkey: dev, identifier: "editor" },
    });
    expect(parseNappletHandlerRef(ROOT)?.type).toBe("address");
    expect(parseNappletHandlerRef(SNAPSHOT)).toEqual({ type: "snapshot", pointer: { id: SNAPSHOT, kind: 5129 } });
    expect(parseNappletHandlerRef(`35129:${dev}:`)).toBeUndefined();
    expect(parseNappletHandlerRef(`15129:${dev}:named`)).toBeUndefined();
    expect(parseNappletHandlerRef(`30023:${dev}:article`)).toBeUndefined();
  });

  it("reads archetype-wide handlers in order", () => {
    const event = preferences([
      ["a", EDITOR, "wss://relay.example.com"],
      ["e", PINNED, "", dev],
      ["a", ROOT],
      ["a", EDITOR],
    ]);

    expect(getPublicNappletHandlers(event).handlers).toEqual([
      {
        type: "address",
        pointer: { kind: 35129, pubkey: dev, identifier: "editor", relays: ["wss://relay.example.com/"] },
      },
      { type: "snapshot", pointer: { id: PINNED, kind: 5129, author: dev } },
      { type: "address", pointer: { kind: 15129, pubkey: dev, identifier: "" } },
    ]);
  });

  it("skips malformed entries and unknown tags", () => {
    const event = preferences([
      ["a", `30023:${dev}:article`],
      ["a", `35129:${dev}:`],
      ["e", "not-an-id"],
      ["i", "napplet:profile/edit?x=1", EDITOR],
      ["i", "napplet:profile/edit#top", EDITOR],
      ["i", "napplet:feed/edit", EDITOR],
      ["i", "napplet:profile/edit", `30023:${dev}:article`],
      ["i", "napplet:profile/edit"],
      ["unknown", "value"],
    ]);

    const entries = getPublicNappletHandlers(event);
    expect(entries.handlers).toEqual([]);
    expect(entries.intents.size).toBe(0);
  });

  it("adds hints from matching a and e tags to i references", () => {
    const event = preferences([
      ["e", SNAPSHOT, "wss://relay.example.com", dev],
      ["i", "napplet:profile/edit", SNAPSHOT],
      ["i", "napplet:profile/edit", VIEWER],
    ]);

    expect(getPublicNappletHandlers(event).intents.get("napplet:profile/edit")).toEqual([
      { type: "snapshot", pointer: { id: SNAPSHOT, kind: 5129, relays: ["wss://relay.example.com/"], author: dev } },
      { type: "address", pointer: { kind: 35129, pubkey: dev, identifier: "viewer" } },
    ]);
  });

  it("compares references without relay hints", () => {
    const a = parseNappletHandlerRef(EDITOR)!;
    const b = getPublicNappletHandlers(preferences([["a", EDITOR, "wss://relay.example.com"]])).handlers[0];
    expect(isSameNappletHandlerRef(a, b)).toBe(true);
    expect(isSameNappletHandlerRef(a, parseNappletHandlerRef(VIEWER)!)).toBe(false);
  });

  it("unlocks private entries", async () => {
    const event = await withHidden([["a", VIEWER]], [["i", "napplet:profile/edit", EDITOR]]);

    expect(getHiddenNappletHandlers(event)).toBeUndefined();
    expect(isHiddenNappletHandlersUnlocked(event)).toBe(false);

    const hidden = await unlockHiddenNappletHandlers(event, user);
    expect(hidden.intents.get("napplet:profile/edit")?.map((r) => r.pointer)).toEqual([
      { kind: 35129, pubkey: dev, identifier: "editor" },
    ]);
    expect(isHiddenNappletHandlersUnlocked(event)).toBe(true);
  });

  it("orders candidates by private and public intents, then private and public handlers", () => {
    const event = preferences([
      ["a", VIEWER],
      ["a", ROOT],
      ["i", "napplet:profile/edit", EDITOR],
      ["i", "napplet:profile/view", ROOT],
    ]);
    setHiddenTagsCache(event, [
      ["e", PINNED],
      ["a", VIEWER],
      ["i", "napplet:profile/edit", SNAPSHOT],
    ]);

    const candidates = getNappletHandlerCandidates(event, "napplet:profile/edit");
    expect(
      candidates.map((c) => [
        c.ref.type === "address" ? c.ref.pointer.identifier : c.ref.pointer.id,
        c.hidden,
        c.intent,
      ]),
    ).toEqual([
      [SNAPSHOT, true, true],
      ["editor", false, true],
      [PINNED, true, false],
      ["viewer", true, false],
      ["", false, false],
    ]);
  });

  it("skips private candidates while locked", async () => {
    const event = await withHidden([["a", VIEWER]], [["a", EDITOR]]);
    expect(getNappletHandlerCandidates(event, "napplet:profile/edit").map((c) => c.hidden)).toEqual([false]);
  });
});
