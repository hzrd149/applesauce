import { describe, expect, it } from "vitest";
import { EventFactory } from "../../event-factory.js";
import { NostrEvent } from "applesauce-core/helpers/event";
import { ShareBlueprint } from "../share.js";

describe("ShareBlueprint", () => {
  const factory = new EventFactory();

  it("should create kind 6 event for kind 1 note", async () => {
    const note: NostrEvent = {
      kind: 1,
      id: "0000a3d394a13fd644f489c64361d7a2f6e995730221dc26e599cb81b349637e",
      pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      created_at: 1733959306,
      tags: [["nonce", "9223372036854784175", "16"]],
      content: "Quantum computers are never going to happen.",
      sig: "0d5cb8ddfa9b769da889f1cd66d76ed1591cfef023c593342e16121cd470d576ba9a07f538e6a7e653768320c144ee44805e0275cc609ae098784b12c044be50",
    };

    expect(await factory.create(ShareBlueprint, note)).toEqual(
      expect.objectContaining({
        kind: 6,
        content: JSON.stringify(note),
        tags: [
          ["e", note.id],
          ["p", note.pubkey],
          ["k", "1"],
        ],
      }),
    );
  });

  it("should create kind 16 event for kind 30023 note", async () => {
    const event: NostrEvent = {
      content: "# The case against edits",
      created_at: 1730991377,
      id: "caa65d8b3b11d887da7188f3fe75c33d7be80d3df8c46f241a275b9075888674",
      kind: 30023,
      pubkey: "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
      sig: "eb30514d222b3ed83a2b3addd8242abe039d88f43330f1f06a1efba8840ea46ce687f60d582237f28bb88845a65de421d25bdda7eb2cb3d3c125b986722c230b",
      tags: [
        ["d", "ad84e3b3"],
        ["title", "The case against edits"],
        ["published_at", "1730973840"],
        ["t", "nostr"],
      ],
    };

    expect(await factory.create(ShareBlueprint, event)).toEqual(
      expect.objectContaining({
        kind: 16,
        content: JSON.stringify(event),
        tags: [
          ["e", event.id],
          ["a", "30023:3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d:ad84e3b3"],
          ["p", event.pubkey],
          ["k", "30023"],
        ],
      }),
    );
  });
});
