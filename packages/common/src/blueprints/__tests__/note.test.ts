import { EventFactory } from "applesauce-core/event-factory";
import { NostrEvent } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { NoteBlueprint, NoteReplyBlueprint } from "../note.js";

let factory = new EventFactory();

describe("NoteBlueprint", () => {
  it("should create a short text note", async () => {
    expect(await factory.create(NoteBlueprint, "hello world")).toEqual(
      expect.objectContaining({ content: "hello world", tags: [], kind: 1 }),
    );
  });

  it("should convert @ mentions", async () => {
    expect(
      await factory.create(NoteBlueprint, "hello @npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"),
    ).toEqual(
      expect.objectContaining({
        content: "hello nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
        tags: [["p", "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"]],
        kind: 1,
      }),
    );
  });

  it("should fix nostr mentions", async () => {
    expect(
      await factory.create(
        NoteBlueprint,
        "cool nevent1qvzqqqqqqypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqyd8wumn8ghj7mr0vd4kymmc9enxjct5dfskvtnrdakj7qgmwaehxw309aex2mrp0yh8wetnw3jhymnzw33jucm0d5hsqgqqqr52tv55e4ndqjumlcp7lvvk76lmnac2zcyj37lq4c9n0p0sd5fcvsgq",
      ),
    ).toEqual(
      expect.objectContaining({
        content:
          "cool nostr:nevent1qvzqqqqqqypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqyd8wumn8ghj7mr0vd4kymmc9enxjct5dfskvtnrdakj7qgmwaehxw309aex2mrp0yh8wetnw3jhymnzw33jucm0d5hsqgqqqr52tv55e4ndqjumlcp7lvvk76lmnac2zcyj37lq4c9n0p0sd5fcvsgq",
        tags: [
          [
            "q",
            "0000e8a5b294cd66d04b9bfe03efb196f6bfb9f70a160928fbe0ae0b3785f06d",
            "wss://lockbox.fiatjaf.com/",
            "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
          ],
        ],
        kind: 1,
      }),
    );
  });

  it("should convert hashtags", async () => {
    expect(await factory.create(NoteBlueprint, "hello #nostr world")).toEqual(
      expect.objectContaining({
        kind: 1,
        content: "hello #nostr world",
        tags: [["t", "nostr"]],
      }),
    );
  });

  it("should handle notes what start with hashtags", async () => {
    expect(await factory.create(NoteBlueprint, "#asknostr hello world")).toEqual(
      expect.objectContaining({
        kind: 1,
        content: "#asknostr hello world",
        tags: [["t", "asknostr"]],
      }),
    );
  });

  it('should "p" tag pubkeys mentioned in content', async () => {
    expect(
      await factory.create(NoteBlueprint, "GM nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"),
    ).toEqual(
      expect.objectContaining({
        tags: [["p", "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"]],
      }),
    );
  });

  it("should repair nostr mentions", async () => {
    expect(
      await factory.create(NoteBlueprint, "GM npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6"),
    ).toEqual(
      expect.objectContaining({
        kind: 1,
        content: "GM nostr:npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6",
        tags: [["p", "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d"]],
      }),
    );
  });

  it("should include emoji tags", async () => {
    expect(
      await factory.create(NoteBlueprint, "building :nostrudel:", {
        emojis: [
          {
            shortcode: "nostrudel",
            url: "https://cdn.hzrd149.com/303f018e613f29e3e43264529903b7c8c84debbd475f89368cb293ec23938981.png",
          },
        ],
      }),
    ).toEqual(
      expect.objectContaining({
        kind: 1,
        content: "building :nostrudel:",
        tags: [
          [
            "emoji",
            "nostrudel",
            "https://cdn.hzrd149.com/303f018e613f29e3e43264529903b7c8c84debbd475f89368cb293ec23938981.png",
          ],
        ],
      }),
    );
  });

  it("should include client tag", async () => {
    const factory = new EventFactory({
      client: {
        name: "noStrudel",
        address: {
          pubkey: "266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5",
          identifier: "1686066542546",
        },
      },
    });

    expect(await factory.create(NoteBlueprint, "GM world")).toEqual(
      expect.objectContaining({
        kind: 1,
        content: "GM world",
        tags: [
          [
            "client",
            "noStrudel",
            "31990:266815e0c9210dfa324c6cba3573b14bee49da4209a9456f9484e5106cd408a5:1686066542546",
          ],
        ],
      }),
    );
  });

  it("should not change nip-19 pointers in URLs", async () => {
    expect(
      await factory.create(
        NoteBlueprint,
        "Checkout my app https://zap.stream/naddr1qqjx2wtzx93rycmz94nrqvf3956rqep3943xgvec956xxvnxxucxze33v93rvq3qeaz6dwsnvwkha5sn5puwwyxjgy26uusundrm684lg3vw4ma5c2jsxpqqqpmxw6td7rf",
      ),
    ).toEqual(
      expect.objectContaining({
        kind: 1,
        content:
          "Checkout my app https://zap.stream/naddr1qqjx2wtzx93rycmz94nrqvf3956rqep3943xgvec956xxvnxxucxze33v93rvq3qeaz6dwsnvwkha5sn5puwwyxjgy26uusundrm684lg3vw4ma5c2jsxpqqqpmxw6td7rf",
        tags: [],
      }),
    );
  });

  it('should include "q" tags for quotes', async () => {
    expect(
      await factory.create(
        NoteBlueprint,
        "good point nostr:nevent1qvzqqqqqqypzqwlsccluhy6xxsr6l9a9uhhxf75g85g8a709tprjcn4e42h053vaqyd8wumn8ghj7urewfsk66ty9enxjct5dfskvtnrdakj7qgmwaehxw309aex2mrp0yh8wetnw3jhymnzw33jucm0d5hsqgqqqrzq4vghcurgc2p3k70xka03m0wsvhwh244gh2f8tnk6dl49vgx9mgmd",
      ),
    ).toEqual(
      expect.objectContaining({
        tags: [
          [
            "q",
            "0000c40ab117c7068c2831b79e6b75f1dbdd065dd7556a8ba9275ceda6fea562",
            "wss://pyramid.fiatjaf.com/",
            "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d",
          ],
        ],
      }),
    );
  });

  it("should include protected tag when protected=true", async () => {
    expect(await factory.create(NoteBlueprint, "hello world", { protected: true })).toEqual(
      expect.objectContaining({
        tags: [["-"]],
      }),
    );
  });

  it("should include expiration tag when expiration is set", async () => {
    expect(await factory.create(NoteBlueprint, "hello world", { expiration: 1716883200 })).toEqual(
      expect.objectContaining({
        tags: [["expiration", "1716883200"]],
      }),
    );
  });
});

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
