import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import {
  buildTorrentMagnetLink,
  createTorrentExternalIdentifier,
  getTorrentCategory,
  getTorrentCategoryPath,
  getTorrentCategoryPathParts,
  getTorrentExternalIdentifiers,
  getTorrentFiles,
  getTorrentInfoHash,
  getTorrentMagnetLink,
  getTorrentSearchTags,
  getTorrentTitle,
  getTorrentTrackers,
  isTorrentInfoHash,
  isValidTorrent,
  TORRENT_KIND,
} from "../torrent.js";

const user = new FakeUser();
const HASH = "a".repeat(40);

// The example event from NIP-35
const torrent = user.event({
  kind: TORRENT_KIND,
  content: "A long description",
  tags: [
    ["title", "Dune: Part Two"],
    ["x", HASH],
    ["file", "info/example.txt", "1024"],
    ["file", "movie.mkv"],
    ["file", "empty.txt", "0"],
    ["tracker", "udp://mytacker.com:1337"],
    ["tracker", "http://1337-tracker.net/announce"],
    ["i", "tcat:video,movie,4k"],
    ["i", "newznab:2045"],
    ["i", "imdb:tt15239678"],
    ["i", "tmdb:movie:693134"],
    ["i", "ttvdb:movie:290272"],
    ["i", "mal:anime:9253"],
    ["i", "anilist:12345"],
    ["t", "movie"],
    ["t", "4k"],
  ],
});

describe("torrent helpers", () => {
  it("parses the title, info hash, trackers and search tags", () => {
    expect(getTorrentTitle(torrent)).toBe("Dune: Part Two");
    expect(getTorrentInfoHash(torrent)).toBe(HASH);
    expect(getTorrentTrackers(torrent)).toEqual(["udp://mytacker.com:1337", "http://1337-tracker.net/announce"]);
    expect(getTorrentSearchTags(torrent)).toEqual(["movie", "4k"]);
  });

  it("parses files with optional sizes", () => {
    expect(getTorrentFiles(torrent)).toEqual([
      { name: "info/example.txt", size: 1024 },
      { name: "movie.mkv" },
      { name: "empty.txt", size: 0 },
    ]);
  });

  it("parses the newznab category and tcat path", () => {
    expect(getTorrentCategory(torrent)).toBe(2045);
    expect(getTorrentCategoryPath(torrent)).toBe("video,movie,4k");
    expect(getTorrentCategoryPathParts(torrent)).toEqual(["video", "movie", "4k"]);
  });

  it("parses external identifiers and skips tcat and newznab", () => {
    expect(getTorrentExternalIdentifiers(torrent)).toEqual([
      { prefix: "imdb", identifier: "imdb:tt15239678", id: "tt15239678" },
      { prefix: "tmdb", identifier: "tmdb:movie:693134", mediaType: "movie", id: "693134" },
      { prefix: "ttvdb", identifier: "ttvdb:movie:290272", mediaType: "movie", id: "290272" },
      { prefix: "mal", identifier: "mal:anime:9253", mediaType: "anime", id: "9253" },
      { prefix: "anilist", identifier: "anilist:12345", id: "12345" },
    ]);
  });

  it("creates external identifiers with and without a media type", () => {
    expect(createTorrentExternalIdentifier("tmdb", "693134", "movie").identifier).toBe("tmdb:movie:693134");
    expect(createTorrentExternalIdentifier("imdb", "tt15239678").identifier).toBe("imdb:tt15239678");
  });

  it("builds an encoded magnet link", () => {
    expect(buildTorrentMagnetLink(HASH, ["udp://t.com:1337"], "a b")).toBe(
      `magnet:?xt=urn:btih:${HASH}&tr=udp%3A%2F%2Ft.com%3A1337&dn=a%20b`,
    );
    expect(getTorrentMagnetLink(torrent)).toMatch(new RegExp(`^magnet:\\?xt=urn:btih:${HASH}&tr=.+&dn=Dune`));
  });

  it("returns empty values for other kinds", () => {
    const note = user.note("hi", { tags: [["x", HASH]] });
    expect(getTorrentInfoHash(note)).toBeUndefined();
    expect(getTorrentFiles(note)).toEqual([]);
    expect(getTorrentCategoryPathParts(note)).toEqual([]);
  });

  it("validates the info hash", () => {
    expect(isTorrentInfoHash(HASH)).toBe(true);
    expect(isTorrentInfoHash("A".repeat(40))).toBe(true);
    expect(isTorrentInfoHash("a".repeat(39))).toBe(false);
    expect(isTorrentInfoHash("z".repeat(40))).toBe(false);
  });

  it("isValidTorrent requires kind 2003 and a V1 info hash", () => {
    expect(isValidTorrent(torrent)).toBe(true);
    expect(isValidTorrent(user.event({ kind: TORRENT_KIND, tags: [["x", "not-a-hash"]] }))).toBe(false);
    expect(isValidTorrent(user.event({ kind: TORRENT_KIND, tags: [] }))).toBe(false);
    expect(isValidTorrent(user.note("hi", { tags: [["x", HASH]] }))).toBe(false);
  });
});
