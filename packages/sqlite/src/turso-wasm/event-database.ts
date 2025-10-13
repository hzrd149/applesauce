import { IAsyncEventDatabase, logger } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers";
import { Database } from "@tursodatabase/database-wasm";
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
  rebuildSearchIndex,
} from "./methods.js";
import { enhancedSearchContentFormatter, FilterWithSearch, SearchContentFormatter } from "../helpers/search.js";

const log = logger.extend("TursoWasmEventDatabase");

/** Options for the {@link TursoWasmEventDatabase} */
export type TursoWasmEventDatabaseOptions = {
  search?: boolean;
  searchContentFormatter?: SearchContentFormatter;
};

export class TursoWasmEventDatabase implements IAsyncEventDatabase {
  db: Database;

  /** If search is enabled */
  private search: boolean;
  /** The search content formatter */
  private searchContentFormatter: SearchContentFormatter;

  constructor(database: Database, options?: TursoWasmEventDatabaseOptions) {
    this.db = database;

    this.search = options?.search ?? false;
    this.searchContentFormatter = options?.searchContentFormatter ?? enhancedSearchContentFormatter;
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
    await createTables(this.db, this.search);
    return this;
  }

  /** Store a Nostr event in the database */
  async add(event: NostrEvent): Promise<NostrEvent> {
    try {
      await insertEvent(this.db, event, this.search ? this.searchContentFormatter : undefined);
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

  /** Checks if an event exists */
  async hasEvent(id: string): Promise<boolean> {
    return await hasEvent(this.db, id);
  }
  /** Get an event by its ID */
  async getEvent(id: string): Promise<NostrEvent | undefined> {
    return await getEvent(this.db, id);
  }

  /** Get the latest replaceable event For replaceable events (10000-19999), returns the most recent event */
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
  async getByFilters(filters: FilterWithSearch | FilterWithSearch[]): Promise<NostrEvent[]> {
    // If search is disabled, remove the search field from the filters
    if (!this.search && (Array.isArray(filters) ? filters.some((f) => "search" in f) : "search" in filters))
      throw new Error("Search is disabled");

    return await getEventsByFilters(this.db, filters);
  }
  /** Get a timeline of events that match the filters (returns array in chronological order, supports NIP-50 search) */
  async getTimeline(filters: FilterWithSearch | FilterWithSearch[]): Promise<NostrEvent[]> {
    // No need to sort since query defaults to created_at descending order
    return await this.getByFilters(filters);
  }

  /** Set the search content formatter */
  setSearchContentFormatter(formatter: SearchContentFormatter): void {
    this.searchContentFormatter = formatter;
  }

  /** Get the current search content formatter */
  getSearchContentFormatter(): SearchContentFormatter {
    return this.searchContentFormatter;
  }

  /** Rebuild the search index for all events */
  async rebuildSearchIndex(): Promise<void> {
    if (!this.search) throw new Error("Search is disabled");

    await rebuildSearchIndex(this.db, this.searchContentFormatter);
    log("Search index rebuilt successfully");
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
