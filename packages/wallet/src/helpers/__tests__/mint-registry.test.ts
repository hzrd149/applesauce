import { describe, expect, it, vi } from "vitest";
import { MintRegistry } from "../mint-registry.js";

describe("MintRegistry", () => {
  it("returns the same Mint instance for the same url", () => {
    const registry = new MintRegistry();
    expect(registry.get("https://mint.example.com")).toBe(registry.get("https://mint.example.com"));
  });

  it("normalizes urls when caching", () => {
    const registry = new MintRegistry();
    expect(registry.get("https://mint.example.com")).toBe(registry.get("https://mint.example.com/"));
  });

  it("reuses instances across sync calls and recreates dropped mints", () => {
    const registry = new MintRegistry();
    const [a1, b1] = registry.sync(["https://a.example.com", "https://b.example.com"]);
    const [a2] = registry.sync(["https://a.example.com"]);
    expect(a2).toBe(a1);
    expect(registry.get("https://b.example.com")).not.toBe(b1);
  });

  it("disconnects removed mints on sync", () => {
    const registry = new MintRegistry();
    const [, b] = registry.sync(["https://a.example.com", "https://b.example.com"]);
    const spy = vi.spyOn(b, "disconnectWebSocket");
    registry.sync(["https://a.example.com"]);
    expect(spy).toHaveBeenCalled();
  });

  it("dispose disconnects every mint and clears the cache", () => {
    const registry = new MintRegistry();
    const mint = registry.get("https://a.example.com");
    const spy = vi.spyOn(mint, "disconnectWebSocket");
    registry.dispose();
    expect(spy).toHaveBeenCalled();
    expect(registry.get("https://a.example.com")).not.toBe(mint);
  });
});
