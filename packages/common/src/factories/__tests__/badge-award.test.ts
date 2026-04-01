import { kinds, type NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { BadgeAwardFactory } from "../badge-award.js";

const HEX = (char: string, length = 64) => char.repeat(length);
const badgeAddress = { kind: kinds.BadgeDefinition, pubkey: HEX("a"), identifier: "alpha" };
const recipientA = { pubkey: HEX("1") };
const recipientB = HEX("2");

describe("BadgeAwardFactory", () => {
  it("builds a badge award event", async () => {
    const event = await BadgeAwardFactory.create().badge(badgeAddress).recipients([recipientA, recipientB]);

    expect(event.kind).toBe(kinds.BadgeAward);
    expect(event.tags).toEqual([
      ["a", `${badgeAddress.kind}:${badgeAddress.pubkey}:${badgeAddress.identifier}`],
      ["p", recipientA.pubkey],
      ["p", recipientB],
    ]);
  });

  it("modifies an existing badge award", async () => {
    const existing: NostrEvent = {
      kind: kinds.BadgeAward,
      id: HEX("f"),
      pubkey: HEX("e"),
      sig: HEX("c", 128),
      created_at: 1,
      content: "",
      tags: [
        ["a", `${badgeAddress.kind}:${badgeAddress.pubkey}:${badgeAddress.identifier}`],
        ["p", recipientA.pubkey],
      ],
    };

    const result = await BadgeAwardFactory.modify(existing).clearBadge().clearRecipients();
    expect(result.tags).toEqual([]);
  });
});
