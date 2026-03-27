import { describe, expect, it } from "vitest";
import { areBlossomServersEqual, blossomServers } from "../blossom.js";

describe("areBlossomServersEqual", () => {
  it("should ignore path", () => {
    expect(areBlossomServersEqual("https://cdn.server.com/pathname", "https://cdn.server.com")).toBe(true);
  });

  it("should not ignore protocol", () => {
    expect(areBlossomServersEqual("http://cdn.server.com", "https://cdn.server.com")).toBe(false);
  });

  it("should not ignore port", () => {
    expect(areBlossomServersEqual("http://cdn.server.com:4658", "https://cdn.server.com")).toBe(false);
  });
});

describe("blossomServers", () => {
  it("returns an empty array when no servers are provided", () => {
    expect(blossomServers()).toEqual([]);
  });

  it("ignores null and undefined values", () => {
    expect(blossomServers(null, undefined, "https://cdn.example.com")).toEqual(["https://cdn.example.com/"]);
  });

  it("strips paths from string servers", () => {
    expect(blossomServers("https://cdn.example.com/path")).toEqual(["https://cdn.example.com/"]);
  });

  it("strips paths from URL servers", () => {
    expect(blossomServers(new URL("https://cdn.example.com/path"))).toEqual([new URL("https://cdn.example.com/")]);
  });

  it("preserves string type for string inputs", () => {
    const result = blossomServers("https://cdn.example.com");
    expect(typeof result[0]).toBe("string");
  });

  it("preserves URL type for URL inputs", () => {
    const result = blossomServers(new URL("https://cdn.example.com"));
    expect(result[0]).toBeInstanceOf(URL);
  });

  it("merges scalar values and arrays into one flat list", () => {
    const result = blossomServers<string | URL>("https://cdn1.example.com", ["https://cdn2.example.com"], new URL("https://cdn3.example.com"));
    expect(result).toEqual(["https://cdn1.example.com/", "https://cdn2.example.com/", new URL("https://cdn3.example.com/")]);
  });

  it("de-duplicates servers by origin", () => {
    expect(
      blossomServers<string | URL>("https://cdn.example.com/path", new URL("https://cdn.example.com/other"), "https://cdn.example.com"),
    ).toEqual(["https://cdn.example.com/"]);
  });

  it("adds https to string servers when the protocol is missing", () => {
    expect(blossomServers("cdn.example.com", "cdn2.example.com/path")).toEqual([
      "https://cdn.example.com/",
      "https://cdn2.example.com/",
    ]);
  });

  it("treats different protocols as distinct servers", () => {
    expect(blossomServers("https://cdn.example.com", "http://cdn.example.com")).toEqual([
      "https://cdn.example.com/",
      "http://cdn.example.com/",
    ]);
  });

  it("treats different ports as distinct servers", () => {
    expect(blossomServers("https://cdn.example.com", "https://cdn.example.com:8443")).toEqual([
      "https://cdn.example.com/",
      "https://cdn.example.com:8443/",
    ]);
  });
});
