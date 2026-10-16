import { EventStore } from "applesauce-core/event-store";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { TORRENT_KIND } from "../../helpers/torrent.js";
import { castEvent } from "../cast.js";
import { Torrent } from "../torrent.js";

const HASH = "a".repeat(40);

describe("torrent cast", () => {
  it("reads torrent metadata", () => {
    const user = new FakeUser();
    const store = new EventStore();
    const event = store.add(
      user.event({
        kind: TORRENT_KIND,
        tags: [
          ["x", HASH],
          ["title", "Dune"],
          ["file", "movie.mkv", "100"],
          ["i", "tcat:video,movie"],
          ["i", "imdb:tt15239678"],
        ],
      }),
    )!;

    const torrent = castEvent(event, Torrent, store);

    expect(torrent.infoHash).toBe(HASH);
    expect(torrent.title).toBe("Dune");
    expect(torrent.files).toEqual([{ name: "movie.mkv", size: 100 }]);
    expect(torrent.categoryPathParts).toEqual(["video", "movie"]);
    expect(torrent.externalIdentifiers.map((id) => id.identifier)).toEqual(["imdb:tt15239678"]);
    expect(torrent.magnetLink).toBe(`magnet:?xt=urn:btih:${HASH}&dn=Dune`);
  });

  it("rejects invalid events", () => {
    const user = new FakeUser();
    const store = new EventStore();

    const note = store.add(user.note("hi"))!;
    expect(() => castEvent(note, Torrent, store)).toThrow();

    const badHash = store.add(user.event({ kind: TORRENT_KIND, tags: [["x", "nope"]] }))!;
    expect(() => castEvent(badHash, Torrent, store)).toThrow();
  });
});
