import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { kinds } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import {
  addRecipient,
  clearBadgePointer,
  clearRecipients,
  removeRecipient,
  setBadgePointer,
  setRecipients,
} from "../../operations/badge-award";
import { FakeUser } from "../../__tests__/fixtures";

const issuer = new FakeUser();
const recipientA = new FakeUser();
const recipientB = new FakeUser();

const badgePointer = { kind: kinds.BadgeDefinition, pubkey: issuer.pubkey, identifier: "alpha" };
const secondBadgePointer = { kind: kinds.BadgeDefinition, pubkey: issuer.pubkey, identifier: "beta" };

function createAwardDraft(tags: string[][] = []): EventTemplate {
  return {
    kind: kinds.BadgeAward,
    content: "",
    tags,
    created_at: unixNow(),
  };
}

describe("badge award operations", () => {
  it("sets and replaces badge pointers", async () => {
    const result = await setBadgePointer(badgePointer)(createAwardDraft());
    expect(result.tags).toEqual([["a", `${badgePointer.kind}:${issuer.pubkey}:${badgePointer.identifier}`]]);

    const updated = await setBadgePointer(secondBadgePointer)(result);
    expect(updated.tags).toEqual([["a", `${secondBadgePointer.kind}:${issuer.pubkey}:${secondBadgePointer.identifier}`]]);
  });

  it("clears badge pointer tags", async () => {
    const draft = createAwardDraft([["a", "30009:pub:alpha"]]);
    const cleared = await clearBadgePointer()(draft);
    expect(cleared.tags).toHaveLength(0);
  });

  it("sets recipients in order", async () => {
    const result = await setRecipients([recipientA, recipientB])(createAwardDraft());
    expect(result.tags).toEqual([
      ["p", recipientA.pubkey],
      ["p", recipientB.pubkey],
    ]);
  });

  it("adds and removes recipients", async () => {
    const withRecipient = await addRecipient(recipientA)(createAwardDraft());
    expect(withRecipient.tags).toEqual([["p", recipientA.pubkey]]);

    const withBoth = await addRecipient(recipientB)(withRecipient);
    expect(withBoth.tags).toEqual([
      ["p", recipientA.pubkey],
      ["p", recipientB.pubkey],
    ]);

    const withoutA = await removeRecipient(recipientA)(withBoth);
    expect(withoutA.tags).toEqual([["p", recipientB.pubkey]]);

    const cleared = await clearRecipients()(withoutA);
    expect(cleared.tags).toHaveLength(0);
  });
});
