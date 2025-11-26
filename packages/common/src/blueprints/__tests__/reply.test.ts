import { describe, expect, it } from "vitest";
import { EventFactory } from "../../event-factory.js";
import { NoteReplyBlueprint } from "../reply.js";
import { NostrEvent } from "applesauce-core/helpers/event";

describe("NoteReplyBlueprint", () => {
  const factory = new EventFactory();

  it("should handle simple note", async () => {
    const parent: NostrEvent = {
      id: "event-id",
      kind: 1,
      content: "GM",
      tags: [],
      created_at: 0,
      pubkey: "pubkey",
      sig: "sig",
    };
    expect(await factory.create(NoteReplyBlueprint, parent, "GM back")).toEqual(
      expect.objectContaining({
        content: "GM back",
        tags: [
          ["e", "event-id", "", "root", "pubkey"],
          ["e", "event-id", "", "reply", "pubkey"],
          ["p", "pubkey"],
        ],
      }),
    );
  });

  it("should reply to a nip-10 note", async () => {
    const parent = {
      content: "Is good. Well done",
      created_at: 1733983424,
      id: "cf8f8e0ba1b4d56883cf6efd8f57ee1676c29d3dd19ca3eb463795a581bae057",
      kind: 1,
      pubkey: "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
      sig: "c2626ebbdca608f2ff5667ab42b3d13d96064e6e4dbaeaf544f0070ddca668ebead143ad833f0a8a5e998709a69094d963ff931d041501d3c29008f54cb9c5ae",
      tags: [
        ["e", "aa74e8488cbc80e2958e86108b76fd15e349095590071d573c168f0265b025d7", "wss://a.nos.lol", "root"],
        ["e", "90f49552601327ca0f3c41d5ec8966252ee56f0cf034b73fd2fcd24b92a48316", "", "reply"],
        ["p", "6cbb55f409d58ceec991eeb1b4aa077931e7d078d649da666128429bb67b690c"],
      ],
    };

    expect(await factory.create(NoteReplyBlueprint, parent, "yes")).toEqual(
      expect.objectContaining({
        content: "yes",
        tags: [
          ["e", "aa74e8488cbc80e2958e86108b76fd15e349095590071d573c168f0265b025d7", "wss://a.nos.lol", "root"],
          [
            "e",
            "cf8f8e0ba1b4d56883cf6efd8f57ee1676c29d3dd19ca3eb463795a581bae057",
            "",
            "reply",
            "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245",
          ],
          ["p", "6cbb55f409d58ceec991eeb1b4aa077931e7d078d649da666128429bb67b690c"],
          ["p", "32e1827635450ebb3c5a7d12c1f8e7b2b514439ac10a67eef3d9fd9c5c68e245"],
        ],
      }),
    );
  });
});
