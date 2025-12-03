import { describe, expect, it } from "vitest";
import { areBlossomServersEqual } from "../blossom.js";

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
