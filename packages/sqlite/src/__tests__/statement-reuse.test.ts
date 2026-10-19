import BetterSqlite3 from "better-sqlite3";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import * as better from "../better-sqlite3/methods.js";
import * as native from "../native/methods.js";
import { GET_EVENT_STATEMENT } from "../helpers/statements.js";

// Exercise the public database methods against real connections, including failed prepares.
for (const driver of [
  { name: "native", open: () => new DatabaseSync(":memory:"), methods: native },
  { name: "better-sqlite3", open: () => new BetterSqlite3(":memory:"), methods: better },
] as const) {
  describe(`${driver.name} statement reuse`, () => {
    it("reuses fixed statements with fresh bindings and isolates connections", () => {
      const first = driver.open();
      const second = driver.open();
      // Both method modules have the same runtime API but different connection types.
      const methods = driver.methods as typeof native;
      const db = first as DatabaseSync;
      const other = second as DatabaseSync;
      try {
        methods.createTables(db, false);
        methods.createTables(other, false);
        const spy = vi.spyOn(db, "prepare");
        const event = {
          id: "a".repeat(64),
          pubkey: "b".repeat(64),
          sig: "c".repeat(128),
          kind: 1,
          created_at: 1000,
          content: "first",
          tags: [["t", "example"]],
        };
        methods.insertEvent(db, event);
        methods.insertEvent(db, { ...event, id: "d".repeat(64), content: "second" });
        expect(methods.getEvent(db, event.id)?.content).toBe("first");
        expect(methods.getEvent(db, "d".repeat(64))?.content).toBe("second");
        expect(methods.getEvent(other, event.id)).toBeUndefined();
        expect(spy.mock.calls.filter(([sql]) => sql === GET_EVENT_STATEMENT.sql)).toHaveLength(1);
        expect(methods.deleteEvent(db, event.id)).toBe(true);
        expect(methods.getEvent(db, event.id)).toBeUndefined();
        expect(methods.getEvent(db, "d".repeat(64))?.content).toBe("second");
      } finally {
        first.close();
        second.close();
      }
    });

    it("reuses filter statements and evicts the least recently used", () => {
      const connection = driver.open();
      const methods = driver.methods as typeof native;
      const db = connection as DatabaseSync;
      try {
        methods.createTables(db, false);
        const spy = vi.spyOn(db, "prepare");
        const ids = (count: number) => Array.from({ length: count }, (_, i) => i.toString(16).padStart(64, "0"));
        methods.getEventsByFilters(db, { ids: ids(1) });
        methods.getEventsByFilters(db, { ids: ids(1) });
        expect(spy).toHaveBeenCalledTimes(1);

        // Each id count builds a different query, enough of them push the first one out
        for (let i = 2; i < 300; i++) methods.getEventsByFilters(db, { ids: ids(i) });
        spy.mockClear();
        methods.getEventsByFilters(db, { ids: ids(1) });
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        connection.close();
      }
    });

    it("can prepare search statements after the search table is created", () => {
      const connection = driver.open();
      const methods = driver.methods as typeof native;
      const db = connection as DatabaseSync;
      try {
        methods.createTables(db, false);
        expect(() => methods.deleteSearchContent(db, "missing")).toThrow();
        methods.createTables(db, true);
        expect(() => methods.deleteSearchContent(db, "missing")).not.toThrow();
        expect(() => methods.deleteSearchContent(db, "another")).not.toThrow();
      } finally {
        connection.close();
      }
    });
  });
}
