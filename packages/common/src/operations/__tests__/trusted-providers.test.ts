import { describe, expect, it } from "vitest";
import { addProviderTag, removeProviderTag, removeServiceTags, setProviderTag } from "../trusted-providers.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("addProviderTag", () => {
  it("appends a new provider tag", async () => {
    const tags = await addProviderTag({ kind: 30382, tag: "rank", servicePubkey: A, relay: "wss://a.com" })([]);
    expect(tags).toEqual([["30382:rank", A, "wss://a.com"]]);
  });

  it("updates the relay hint of an existing provider", async () => {
    const tags = await addProviderTag({ kind: 30382, tag: "rank", servicePubkey: A, relay: "wss://b.com" })([
      ["30382:rank", A, "wss://a.com"],
      ["30382:rank", B],
    ]);
    expect(tags).toEqual([
      ["30382:rank", A, "wss://b.com"],
      ["30382:rank", B],
    ]);
  });
});

describe("removeProviderTag", () => {
  const tags = [
    ["30382:rank", A],
    ["30382:rank", B],
    ["30383:rank", A],
  ];

  it("removes a single provider", async () => {
    expect(await removeProviderTag({ kind: 30382, tag: "rank", servicePubkey: A })(tags)).toEqual([
      ["30382:rank", B],
      ["30383:rank", A],
    ]);
  });

  it("clears the whole slot without a pubkey", async () => {
    expect(await removeProviderTag({ kind: 30382, tag: "rank" })(tags)).toEqual([["30383:rank", A]]);
  });
});

describe("setProviderTag", () => {
  it("replaces every provider in the slot", async () => {
    const tags = await setProviderTag({ kind: 30382, tag: "rank", servicePubkey: B })([
      ["30382:rank", A],
      ["30382:followers", A],
    ]);
    expect(tags).toEqual([
      ["30382:followers", A],
      ["30382:rank", B],
    ]);
  });
});

describe("removeServiceTags", () => {
  it("removes a service from every slot", async () => {
    const tags = await removeServiceTags(A)([
      ["30382:rank", A],
      ["30383:rank", A],
      ["30382:rank", B],
    ]);
    expect(tags).toEqual([["30382:rank", B]]);
  });
});
