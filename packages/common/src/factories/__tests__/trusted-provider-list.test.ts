import { getHiddenTags, unlockHiddenTags } from "applesauce-core/helpers/hidden-tags";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { TrustedProviderListFactory } from "../trusted-provider-list.js";

const A = "a".repeat(64);
const B = "b".repeat(64);

describe("TrustedProviderListFactory", () => {
  it("creates a public provider list", async () => {
    const draft = await TrustedProviderListFactory.create().addProvider({
      kind: 30382,
      tag: "rank",
      servicePubkey: A,
      relay: "wss://relay.com",
    });
    expect(draft.kind).toBe(10040);
    expect(draft.tags).toEqual([["30382:rank", A, "wss://relay.com"]]);
  });

  it("modifies an existing list", async () => {
    const user = new FakeUser();
    const existing = user.event({
      kind: 10040,
      tags: [
        ["30382:rank", A],
        ["30383:rank", A],
      ],
    });
    const draft = await TrustedProviderListFactory.modify(existing)
      .setProvider({ kind: 30382, tag: "rank", servicePubkey: B })
      .removeService(A);
    expect(draft.tags).toEqual([["30382:rank", B]]);
  });

  it("throws when modifying another kind", () => {
    expect(() => TrustedProviderListFactory.modify(new FakeUser().event({ kind: 1 }))).toThrow();
  });

  it("adds hidden providers", async () => {
    const user = new FakeUser();
    const event = await TrustedProviderListFactory.create()
      .as(user)
      .addProvider({ kind: 30382, tag: "rank", servicePubkey: A }, true)
      .sign();

    expect(event.tags).toEqual([]);
    expect(event.content).not.toBe("");
    await unlockHiddenTags(event, user);
    expect(getHiddenTags(event)).toEqual([["30382:rank", A]]);
  });
});
