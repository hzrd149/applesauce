import { kinds } from "applesauce-core/helpers/event";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { createTorrentExternalIdentifier, TORRENT_KIND } from "../../helpers/torrent.js";
import { TorrentFactory } from "../torrent.js";

const user = new FakeUser();
const HASH = "a".repeat(40);

describe("TorrentFactory", () => {
  it("builds a torrent event", async () => {
    const event = await TorrentFactory.create(HASH, "Description")
      .title("Dune")
      .files([{ name: "movie.mkv", size: 100 }, { name: "readme.txt" }])
      .trackers(["udp://a", "http://b/announce"])
      .categoryPath("video,movie,4k")
      .category(2045)
      .externalIds([createTorrentExternalIdentifier("imdb", "tt15239678")])
      .searchTags(["movie", "4k"]);

    expect(event.kind).toBe(TORRENT_KIND);
    expect(event.content).toBe("Description");
    expect(event.tags).toEqual([
      ["x", HASH],
      ["title", "Dune"],
      ["file", "movie.mkv", "100"],
      ["file", "readme.txt"],
      ["tracker", "udp://a"],
      ["tracker", "http://b/announce"],
      ["i", "tcat:video,movie,4k"],
      ["i", "newznab:2045"],
      ["i", "imdb:tt15239678"],
      ["t", "movie"],
      ["t", "4k"],
    ]);
  });

  it("modifies an existing torrent event", async () => {
    const existing = user.event({
      kind: TORRENT_KIND,
      tags: [
        ["x", HASH],
        ["file", "old.txt"],
        ["tracker", "udp://old"],
        ["i", "tcat:video"],
        ["i", "newznab:2000"],
        ["i", "imdb:tt1"],
        ["t", "old"],
      ],
    });

    const event = await TorrentFactory.modify(existing)
      .removeFile("old.txt")
      .addFile({ name: "new.txt", size: 0 })
      .removeTracker("udp://old")
      .clearCategoryPath()
      .clearCategory()
      .removeExternalId("imdb:tt1")
      .removeSearchTag("old");

    expect(event.tags).toEqual([
      ["x", HASH],
      ["file", "new.txt", "0"],
    ]);
  });

  it("throws when modifying a non-torrent event", () => {
    expect(() => TorrentFactory.modify(user.event({ kind: kinds.ShortTextNote }))).toThrow();
  });
});
