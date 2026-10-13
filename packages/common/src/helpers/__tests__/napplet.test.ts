import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  getNappletArchetypes,
  getNappletArtifactHash,
  getNappletDescription,
  getNappletIcon,
  getNappletIdentifier,
  getNappletIntents,
  getNappletOptionalDomains,
  getNappletParentPointer,
  getNappletRequiredDomains,
  getNappletRootPointer,
  getNappletServers,
  getNappletSource,
  getNappletTitle,
  isNamedNapplet,
  isNappletSnapshot,
  isRootNapplet,
  isValidNamedNapplet,
  isValidNapplet,
  isValidNappletSnapshot,
  isValidRootNapplet,
  NAPPLET_KIND,
  NAPPLET_ROOT_KIND,
  NAPPLET_SNAPSHOT_KIND,
} from "../napplet.js";

const user = new FakeUser();
const HASH = "186ea5fd14e88fd1ac49351759e7ab906fa94892002b60bf7f5a428f28ca1c99";
const ICON = "ae7a3bd1a3fa9d824d0e64a6f57fe6cb4dd80c423786b6a2ecb94d587c94c75a";
const PARENT = `${NAPPLET_KIND}:${"a".repeat(64)}:my-napplet`;
const ROOT = `${NAPPLET_ROOT_KIND}:${"b".repeat(64)}:`;

function named(tags: string[][] = [], content = "A feed viewer") {
  return user.event({ kind: NAPPLET_KIND, content, tags: [["d", "my-napplet"], ["x", HASH], ...tags] });
}

describe("isValidNapplet", () => {
  it("accepts all three napplet kinds", () => {
    expect(isValidNapplet(named())).toBe(true);
    expect(isValidNapplet(user.event({ kind: NAPPLET_ROOT_KIND, content: "root", tags: [["x", HASH]] }))).toBe(true);
    expect(isValidNapplet(user.event({ kind: NAPPLET_SNAPSHOT_KIND, content: "snap", tags: [["x", HASH]] }))).toBe(
      true,
    );
  });

  it("rejects the wrong kind", () => {
    expect(isValidNapplet(user.event({ kind: 1, content: "note", tags: [["x", HASH]] }))).toBe(false);
  });

  it("rejects a missing or duplicate x tag", () => {
    expect(isValidNapplet(user.event({ kind: NAPPLET_KIND, content: "x", tags: [["d", "a"]] }))).toBe(false);
    expect(isValidNapplet(named([["x", HASH]]))).toBe(false);
  });

  it("rejects an x tag that is not lowercase hex", () => {
    const upper = user.event({ kind: NAPPLET_ROOT_KIND, content: "x", tags: [["x", HASH.toUpperCase()]] });
    const short = user.event({ kind: NAPPLET_ROOT_KIND, content: "x", tags: [["x", "abc"]] });
    expect(isValidNapplet(upper)).toBe(false);
    expect(isValidNapplet(short)).toBe(false);
  });

  it("rejects empty content", () => {
    expect(isValidNapplet(named([], ""))).toBe(false);
    expect(isValidNapplet(named([], "   "))).toBe(false);
  });

  it("enforces d tag rules", () => {
    expect(isValidNapplet(user.event({ kind: NAPPLET_KIND, content: "x", tags: [["x", HASH]] }))).toBe(false);
    expect(isValidNapplet(named([["d", "other"]]))).toBe(false);
    const root = user.event({
      kind: NAPPLET_ROOT_KIND,
      content: "x",
      tags: [
        ["d", "a"],
        ["x", HASH],
      ],
    });
    expect(isValidNapplet(root)).toBe(false);
    const snap = user.event({
      kind: NAPPLET_SNAPSHOT_KIND,
      content: "x",
      tags: [
        ["d", "a"],
        ["x", HASH],
      ],
    });
    expect(isValidNapplet(snap)).toBe(false);
  });
});

describe("napplet kind checks", () => {
  it("detects each kind", () => {
    const snap = user.event({ kind: NAPPLET_SNAPSHOT_KIND, content: "x", tags: [["x", HASH]] });
    const root = user.event({ kind: NAPPLET_ROOT_KIND, content: "x", tags: [["x", HASH]] });
    expect(isNappletSnapshot(snap)).toBe(true);
    expect(isRootNapplet(root)).toBe(true);
    expect(isNamedNapplet(named())).toBe(true);
    expect(isNamedNapplet(root)).toBe(false);
  });
});

describe("napplet getters", () => {
  const event = named([
    ["z", "feed"],
    ["i", "napplet:feed/open"],
    ["i", "napplet:feed/edit", "filters", "relays"],
    ["R", "relay"],
    ["O", "theme"],
    ["icon", ICON, "image/png"],
    ["server", "https://blossom.example.com"],
    ["title", "My Napplet"],
    ["source", "https://github.com/example/my-napplet"],
  ]);

  it("reads the manifest fields", () => {
    expect(getNappletIdentifier(event)).toBe("my-napplet");
    expect(getNappletArtifactHash(event)).toBe(HASH);
    expect(getNappletDescription(event)).toBe("A feed viewer");
    expect(getNappletTitle(event)).toBe("My Napplet");
    expect(getNappletSource(event)).toBe("https://github.com/example/my-napplet");
    expect(getNappletServers(event)).toEqual(["https://blossom.example.com"]);
    expect(getNappletArchetypes(event)).toEqual(["feed"]);
    expect(getNappletRequiredDomains(event)).toEqual(["relay"]);
    expect(getNappletOptionalDomains(event)).toEqual(["theme"]);
    expect(getNappletIcon(event)).toEqual({ sha256: ICON, type: "image/png" });
  });

  it("parses intents and their params", () => {
    expect(getNappletIntents(event)).toEqual([
      { intent: "napplet:feed/open", params: [] },
      { intent: "napplet:feed/edit", params: ["filters", "relays"] },
    ]);
  });

  it("rejects unsupported or malformed icons", () => {
    expect(getNappletIcon(named([["icon", ICON, "image/svg+xml"]]))).toBeUndefined();
    expect(getNappletIcon(named([["icon", "abc", "image/png"]]))).toBeUndefined();
    expect(getNappletIcon(named([["icon", ICON]]))).toBeUndefined();
  });
});

describe("napplet lineage", () => {
  it("reads a and A tags on snapshots", () => {
    const snap = user.event({
      kind: NAPPLET_SNAPSHOT_KIND,
      content: "x",
      tags: [
        ["x", HASH],
        ["a", PARENT, "wss://relay.example.com/"],
        ["A", ROOT],
      ],
    });
    expect(getNappletParentPointer(snap)).toEqual({
      kind: NAPPLET_KIND,
      pubkey: "a".repeat(64),
      identifier: "my-napplet",
      relays: ["wss://relay.example.com/"],
    });
    expect(getNappletRootPointer(snap)).toEqual({ kind: NAPPLET_ROOT_KIND, pubkey: "b".repeat(64), identifier: "" });
  });

  it("ignores a and A tags on non-snapshot kinds", () => {
    const event = named([
      ["a", PARENT],
      ["A", ROOT],
    ]);
    expect(getNappletParentPointer(event)).toBeUndefined();
    expect(getNappletRootPointer(event)).toBeUndefined();
  });
});

describe("per-kind validators", () => {
  it("only accept valid manifests of their own kind", () => {
    const root = user.event({ kind: NAPPLET_ROOT_KIND, content: "root", tags: [["x", HASH]] });
    const snapshot = user.event({ kind: NAPPLET_SNAPSHOT_KIND, content: "snap", tags: [["x", HASH]] });

    expect(isValidNamedNapplet(named())).toBe(true);
    expect(isValidNamedNapplet(root)).toBe(false);
    expect(isValidNamedNapplet(named([], ""))).toBe(false);
    expect(isValidRootNapplet(root)).toBe(true);
    expect(isValidRootNapplet(snapshot)).toBe(false);
    expect(isValidNappletSnapshot(snapshot)).toBe(true);
    expect(isValidNappletSnapshot(named())).toBe(false);
  });
});
