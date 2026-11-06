import { describe, expect, it } from "vitest";
import { MemoryConversationIndexStore } from "../conversation-index.js";

describe("MemoryConversationIndexStore", () => {
  it("lists ties with the higher id first, matching the IndexedDB store", () => {
    const store = new MemoryConversationIndexStore();
    const ids = ["0a", "0B", "0b", "1a"].map((prefix) => prefix.padEnd(64, "0"));
    for (const id of ids) store.set({ id, lastMessageId: "f".repeat(64), lastActivity: 10 });
    store.set({ id: "2".repeat(64), lastMessageId: "f".repeat(64), lastActivity: 20 });

    // Uppercase sorts below lowercase by code unit, where locale comparison would place 0B next to 0b
    expect(store.list().map((entry) => entry.id.slice(0, 2))).toEqual(["22", "1a", "0b", "0a", "0B"]);
  });
});
