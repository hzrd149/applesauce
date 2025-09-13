import { IEventDatabase, InMemoryEventDatabase, logger } from "applesauce-core";
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
  private memory = new InMemoryEventDatabase();

  constructor(database: string | TDatabase = ":memory:") {
    this.db = typeof database === "string" ? new Database(database) : database;

    // Setup the database tables and indexes
    createTables(this.db);

    // Bind helper method to make it easier to use
    this.mapToMemory = this.mapToMemory.bind(this);
  }

  /** A method to add all events to memory to ensure there is only ever a single instance of an event */
  private mapToMemory(event: NostrEvent | undefined): NostrEvent | undefined {
    if (event === undefined) return undefined;
    return this.memory.add(event) ?? undefined;
  }

  /** Store a Nostr event in the database */
  add(event: NostrEvent): NostrEvent | null {
    // Add the event to memory and get the cached instance
    const cached = this.memory.add(event);

    // If its not a new event, return the cached event instance
    if (cached !== event) return cached;

    // Otherwise if its a new event, insert the event into the database
    try {
      const success = insertEvent(this.db, event);
      return success ? (this.mapToMemory(event) ?? null) : null;
    } catch (error) {
      log("Error adding event:", error);
      return null;
    }
  }
  /** Delete an event by ID */
  remove(id: string): boolean {
    try {
      // Ensure the event is removed from memory
      this.memory.remove(id);

      // Remove event from database
      return deleteEvent(this.db, id);
    } catch (error) {
      return false;
    }
  }
  /** Notify the database that an event has been updated */
  update(_event: NostrEvent): void {
    // Do nothing because its the event stores job to handle updates
  }

  /** Checks if an event exists */
  hasEvent(id: string): boolean {
    // Check if the event exists in memory first, then in the database
    return this.memory.hasEvent(id) || hasEvent(this.db, id);
  }
  /** Get an event by its ID */
  getEvent(id: string): NostrEvent | undefined {
    // Get the event from memory first, then from the database
    return this.memory.getEvent(id) ?? this.mapToMemory(getEvent(this.db, id));
  }

  /** Get the latest replaceable event For replaceable events (10000-19999), returns the most recent event */
  getReplaceable(kind: number, pubkey: string, identifier: string = ""): NostrEvent | undefined {
    return (
      // Get the event from memory first
      this.memory.getReplaceable(kind, pubkey, identifier) ??
      // Then get the event from the database
      this.mapToMemory(getReplaceable(this.db, kind, pubkey, identifier))
    );
  }
  /** Checks if a replaceable event exists */
  hasReplaceable(kind: number, pubkey: string, identifier: string = ""): boolean {
    // Check if the event exists in memory first, then in the database
    return this.memory.hasReplaceable(kind, pubkey, identifier) || hasReplaceable(this.db, kind, pubkey, identifier);
  }
  /** Returns all the versions of a replaceable event */
  getReplaceableHistory(kind: number, pubkey: string, identifier: string = ""): NostrEvent[] {
    return (
      // Get the event from memory first
      this.memory.getReplaceableHistory(kind, pubkey, identifier) ??
      // Then get the event from the database
      getReplaceableHistory(this.db, kind, pubkey, identifier).map((e) => this.mapToMemory(e) ?? e)
    );
  }

  /** Get all events that match the filters */
  getByFilters(filters: Filter | Filter[]): Set<NostrEvent> {
    // NOTE: no way to read from memory since memory wont have the full set of events
    try {
      const events = getEventsByFilters(this.db, filters);
      // TODO: mapping events to memory should happen as the query level for better performance
      return new Set(Array.from(events).map((e) => this.mapToMemory(e) ?? e));
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

  // Claim methods (mirror in memory database)
  touch(event: NostrEvent): void {
    return this.memory.touch(event);
  }
  claim(event: NostrEvent, claim: any): void {
    return this.memory.claim(event, claim);
  }
  isClaimed(event: NostrEvent): boolean {
    return this.memory.isClaimed(event);
  }
  removeClaim(event: NostrEvent, claim: any): void {
    return this.memory.removeClaim(event, claim);
  }
  clearClaim(event: NostrEvent): void {
    return this.memory.clearClaim(event);
  }
  unclaimed(): Generator<NostrEvent> {
    return this.memory.unclaimed();
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
