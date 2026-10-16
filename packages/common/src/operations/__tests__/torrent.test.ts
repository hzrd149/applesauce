import { EventTemplate, unixNow } from "applesauce-core/helpers";
import { describe, expect, it } from "vitest";
import { TORRENT_KIND } from "../../helpers/torrent.js";
import {
  addTorrentExternalIdentifierByParts,
  addTorrentFile,
  addTorrentSearchTag,
  addTorrentTracker,
  removeTorrentCategory,
  removeTorrentCategoryPath,
  removeTorrentExternalIdentifier,
  removeTorrentFile,
  removeTorrentSearchTag,
  removeTorrentTracker,
  setTorrentCategory,
  setTorrentCategoryPath,
  setTorrentInfoHash,
  setTorrentTitle,
} from "../torrent.js";

function draft(tags: string[][] = []): EventTemplate {
  return { kind: TORRENT_KIND, content: "", tags, created_at: unixNow() };
}

describe("torrent operations", () => {
  it("sets the info hash and title as singleton tags", async () => {
    const result = await setTorrentTitle("New")(
      await setTorrentInfoHash("b")(
        draft([
          ["x", "a"],
          ["title", "Old"],
        ]),
      ),
    );
    expect(result.tags).toEqual([
      ["x", "b"],
      ["title", "New"],
    ]);
  });

  it("adds and removes files", async () => {
    let result = await addTorrentFile({ name: "a.txt", size: 10 })(draft());
    result = await addTorrentFile({ name: "b.txt" })(result);
    result = await addTorrentFile({ name: "empty.txt", size: 0 })(result);
    expect(result.tags).toEqual([
      ["file", "a.txt", "10"],
      ["file", "b.txt"],
      ["file", "empty.txt", "0"],
    ]);

    result = await removeTorrentFile("a.txt")(result);
    expect(result.tags).toEqual([
      ["file", "b.txt"],
      ["file", "empty.txt", "0"],
    ]);
  });

  it("adds and removes trackers and search tags", async () => {
    let result = await addTorrentTracker("udp://a")(draft());
    result = await addTorrentSearchTag("movie")(result);
    expect(result.tags).toEqual([
      ["tracker", "udp://a"],
      ["t", "movie"],
    ]);

    result = await removeTorrentSearchTag("movie")(await removeTorrentTracker("udp://a")(result));
    expect(result.tags).toEqual([]);
  });

  it("does not overwrite other i tags when setting the category or category path", async () => {
    let result = await addTorrentExternalIdentifierByParts("imdb", "tt15239678")(draft());
    result = await setTorrentCategoryPath("video,movie")(result);
    result = await setTorrentCategory(2045)(result);
    expect(result.tags).toEqual([
      ["i", "imdb:tt15239678"],
      ["i", "tcat:video,movie"],
      ["i", "newznab:2045"],
    ]);
  });

  it("replaces an existing category and category path in place", async () => {
    let result = draft([
      ["i", "newznab:2000"],
      ["i", "imdb:tt1"],
      ["i", "tcat:video"],
      ["i", "newznab:2010"],
    ]);
    result = await setTorrentCategory(2045)(result);
    result = await setTorrentCategoryPath("video,movie,4k")(result);
    expect(result.tags).toEqual([
      ["i", "newznab:2045"],
      ["i", "imdb:tt1"],
      ["i", "tcat:video,movie,4k"],
    ]);
  });

  it("removes the category and category path without touching other i tags", async () => {
    let result = draft([
      ["i", "newznab:2045"],
      ["i", "tcat:video"],
      ["i", "imdb:tt1"],
    ]);
    result = await removeTorrentCategoryPath()(await removeTorrentCategory()(result));
    expect(result.tags).toEqual([["i", "imdb:tt1"]]);
  });

  it("adds and removes external identifiers", async () => {
    let result = await addTorrentExternalIdentifierByParts("tmdb", "693134", "movie")(draft());
    expect(result.tags).toEqual([["i", "tmdb:movie:693134"]]);

    result = await removeTorrentExternalIdentifier("tmdb:movie:693134")(result);
    expect(result.tags).toEqual([]);
  });
});
