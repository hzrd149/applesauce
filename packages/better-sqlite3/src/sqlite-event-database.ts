import { IEventDatabase, logger } from "applesauce-core";
import { Filter, insertEventIntoDescendingList, NostrEvent } from "applesauce-core/helpers";
import Database, { type Database as TDatabase } from "better-sqlite3";
import {
  createTables,
  deleteEvent,
  getEvent,
  getEventsByFilters,
  getReplaceable,
  getReplaceableHistory,
  hasEvent,
  hasReplaceable,
  insertEvent,
} from "./helpers/sqlite.js";

const log = logger.extend("SqliteEventDatabase");

export class SqliteEventDatabase implements IEventDatabase {
  db: TDatabase;

  constructor(database: string | TDatabase = ":memory:") {
    this.db = typeof database === "string" ? new Database(database) : database;

    // Setup the database tables and indexes
    createTables(this.db);
  }

  /** Store a Nostr event in the database */
  add(event: NostrEvent): NostrEvent {
    try {
      insertEvent(this.db, event);
      return event;
    } catch (error) {
      log("Error inserting event:", error);
      throw error;
    }
  }
  /** Delete an event by ID */
  remove(id: string): boolean {
    try {
      // Remove event from database
      return deleteEvent(this.db, id);
    } catch (error) {
      return false;
    }
  }

  /** Checks if an event exists */
  hasEvent(id: string): boolean {
    return hasEvent(this.db, id);
  }
  /** Get an event by its ID */
  getEvent(id: string): NostrEvent | undefined {
    return getEvent(this.db, id);
  }

  /** Get the latest replaceable event For replaceable events (10000-19999), returns the most recent event */
  getReplaceable(kind: number, pubkey: string, identifier: string = ""): NostrEvent | undefined {
    return getReplaceable(this.db, kind, pubkey, identifier);
  }
  /** Checks if a replaceable event exists */
  hasReplaceable(kind: number, pubkey: string, identifier: string = ""): boolean {
    return hasReplaceable(this.db, kind, pubkey, identifier);
  }
  /** Returns all the versions of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier: string = ""): NostrEvent[] {
    return getReplaceableHistory(this.db, kind, pubkey, identifier);
  }

  /** Get all events that match the filters */
  getByFilters(filters: Filter | Filter[]): Set<NostrEvent> {
    try {
      return getEventsByFilters(this.db, filters);
    } catch (error) {
      return new Set();
    }
  }
  /** Get a timeline of events that match the filters (returns array in chronological order) */
  getTimeline(filters: Filter | Filter[]): NostrEvent[] {
    const events = this.getByFilters(filters);
    const timeline: NostrEvent[] = [];
    for (const event of events) insertEventIntoDescendingList(timeline, event);
    return timeline;
  }

  /** Close the database connection */
  close(): void {
    log("Closing database connection");
    this.db.close();
  }
  [Symbol.dispose]() {
    this.close();
  }
}
