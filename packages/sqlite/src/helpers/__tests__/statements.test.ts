import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import {
  CREATE_EVENTS_TABLE_STATEMENT,
  CREATE_EVENT_TAGS_TABLE_STATEMENT,
  INSERT_EVENT_STATEMENT,
  INSERT_EVENT_TAG_STATEMENT,
  INSERT_EVENT_TAG_STATEMENT_WITH_IGNORE,
} from "../statements.js";

describe("INSERT_EVENT_TAG_STATEMENT", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("should throw for duplicate tag inserts", () => {
    db = new Database(":memory:");
    db.exec(CREATE_EVENTS_TABLE_STATEMENT.sql);
    db.exec(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

    db.prepare(INSERT_EVENT_STATEMENT.sql).run("event-id", 1, "pubkey", 1, "content", "[]", "sig", "");

    const insertTag = db.prepare(INSERT_EVENT_TAG_STATEMENT.sql);

    expect(() => {
      insertTag.run("event-id", "t", "meme");
      insertTag.run("event-id", "t", "meme");
    }).toThrow(/UNIQUE constraint failed/);
  });
});

describe("INSERT_EVENT_TAG_STATEMENT_WITH_IGNORE", () => {
  let db: Database.Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("should ignore duplicate tag inserts for the same event", () => {
    db = new Database(":memory:");
    db.exec(CREATE_EVENTS_TABLE_STATEMENT.sql);
    db.exec(CREATE_EVENT_TAGS_TABLE_STATEMENT.sql);

    db.prepare(INSERT_EVENT_STATEMENT.sql).run("event-id", 1, "pubkey", 1, "content", "[]", "sig", "");

    const insertTag = db.prepare(INSERT_EVENT_TAG_STATEMENT_WITH_IGNORE.sql);

    expect(() => {
      insertTag.run("event-id", "t", "meme");
      insertTag.run("event-id", "t", "meme");
    }).not.toThrow();
  });
});
