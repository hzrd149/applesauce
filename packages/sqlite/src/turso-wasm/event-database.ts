import { Database } from "@tursodatabase/database-wasm";
import { IAsyncEventDatabase, logger } from "applesauce-core";
import { Filter, NostrEvent } from "applesauce-core/helpers";
import {
  createTables,
  deleteEvent,
  deleteEventsByFilters,
  getEvent,
  getEventsByFilters,
  getReplaceable,
  getReplaceableHistory,
  hasEvent,
  hasReplaceable,
  insertEvent,
} from "./methods.js";

const log = logger.extend("TursoWasmEventDatabase");

/** Options for the {@link TursoWasmEventDatabase} */
export type TursoWasmEventDatabaseOptions = {};

export class TursoWasmEventDatabase implements IAsyncEventDatabase {
  db: Database;

  constructor(database: Database, _options?: TursoWasmEventDatabaseOptions) {
    this.db = database;
  }

  /** Create a TursoWasmEventDatabase from a database and initialize it */
  static async fromDatabase(
    database: Database,
    options?: TursoWasmEventDatabaseOptions,
  ): Promise<TursoWasmEventDatabase> {
    const eventDatabase = new TursoWasmEventDatabase(database, options);
    return await eventDatabase.initialize();
  }

  /** Initialize the database by creating tables and indexes */
  async initialize(): Promise<this> {
    await createTables(this.db);
    return this;
  }

  /** Store a Nostr event in the database */
  async add(event: NostrEvent): Promise<NostrEvent> {
    try {
      await insertEvent(this.db, event);
      return event;
    } catch (error) {
      log("Error inserting event:", error);
      throw error;
    }
  }
  /** Delete an event by ID */
  async remove(id: string): Promise<boolean> {
    try {
      // Remove event from database
      return await deleteEvent(this.db, id);
    } catch (error) {
      return false;
    }
  }

  /** Remove multiple events that match the given filters */
  async removeByFilters(filters: Filter | Filter[]): Promise<number> {
    return await deleteEventsByFilters(this.db, filters);
  }

  /** Checks if an event exists */
  async hasEvent(id: string): Promise<boolean> {
    return await hasEvent(this.db, id);
  }
  /** Get an event by its ID */
  async getEvent(id: string): Promise<NostrEvent | undefined> {
    return await getEvent(this.db, id);
  }

  /** Get the latest replaceable event For replaceable events (10000-19999 and 30000-39999), returns the most recent event */
  async getReplaceable(kind: number, pubkey: string, identifier: string = ""): Promise<NostrEvent | undefined> {
    return await getReplaceable(this.db, kind, pubkey, identifier);
  }
  /** Checks if a replaceable event exists */
  async hasReplaceable(kind: number, pubkey: string, identifier: string = ""): Promise<boolean> {
    return await hasReplaceable(this.db, kind, pubkey, identifier);
  }
  /** Returns all the versions of a replaceable event */
  async getReplaceableHistory(
    kind: number,
    pubkey: string,
    identifier: string = "",
  ): Promise<NostrEvent[] | undefined> {
    return await getReplaceableHistory(this.db, kind, pubkey, identifier);
  }

  /** Get all events that match the filters (supports NIP-50 search field) */
  async getByFilters(filters: Filter | Filter[]): Promise<NostrEvent[]> {
    // If search is disabled, remove the search field from the filters
    if (Array.isArray(filters) ? filters.some((f) => "search" in f) : "search" in filters)
      throw new Error("Search is not supported");

    return await getEventsByFilters(this.db, filters);
  }
  /** Get a timeline of events that match the filters (returns array in chronological order, supports NIP-50 search) */
  async getTimeline(filters: Filter | Filter[]): Promise<NostrEvent[]> {
    if (Array.isArray(filters) ? filters.some((f) => "search" in f) : "search" in filters)
      throw new Error("Search is not supported");

    // No need to sort since query defaults to created_at descending order
    return await this.getByFilters(filters);
  }

  /** Close the database connection */
  async close(): Promise<void> {
    log("Closing database connection");
    await this.db.close();
  }
  [Symbol.dispose]() {
    // Note: dispose is synchronous, but close is async
    // This is a limitation of the dispose pattern
    this.close().catch((error) => {
      log("Error closing database in dispose:", error);
    });
  }
}
