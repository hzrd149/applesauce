import { type NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { EXTERNAL_IDENTITIES_KIND } from "../../helpers/external-identities.js";
import { ExternalIdentitiesFactory } from "../external-identities.js";

const HEX = (char: string, length = 64) => char.repeat(length);

describe("ExternalIdentitiesFactory", () => {
  it("builds an identities list", async () => {
    const draft = await ExternalIdentitiesFactory.create().addIdentity({
      platform: "github",
      identity: "alice",
      proof: "abc",
    });

    expect(draft.kind).toBe(EXTERNAL_IDENTITIES_KIND);
    expect(draft.tags).toEqual([["i", "github:alice", "abc"]]);
  });

  it("modifies an identities list", async () => {
    const existing: NostrEvent = {
      kind: EXTERNAL_IDENTITIES_KIND,
      id: HEX("1"),
      pubkey: HEX("2"),
      sig: HEX("a", 128),
      created_at: 1,
      content: "",
      tags: [
        ["i", "github:alice", "abc"],
        ["i", "twitter:alice", "123"],
      ],
    };

    const draft = await ExternalIdentitiesFactory.modify(existing).removeIdentity("twitter", "alice");

    expect(draft.tags).toEqual([["i", "github:alice", "abc"]]);
  });
});
