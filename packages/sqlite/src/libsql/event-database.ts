import { Client, createClient } from "@libsql/client";
import { IAsyncEventDatabase, logger } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers";
import { enhancedSearchContentFormatter, FilterWithSearch, SearchContentFormatter } from "../helpers/search.js";
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
  rebuildSearchIndex,
} from "./methods.js";

const log = logger.extend("LibsqlEventDatabase");

/** Options for the {@link LibsqlEventDatabase} */
export type LibsqlEventDatabaseOptions = {
  search?: boolean;
  searchContentFormatter?: SearchContentFormatter;
};

export class LibsqlEventDatabase implements IAsyncEventDatabase {
  db: Client;

  /** If search is enabled */
  private search: boolean;
  /** The search content formatter */
  private searchContentFormatter: SearchContentFormatter;

  constructor(database: string | Client, options?: LibsqlEventDatabaseOptions) {
    this.db = typeof database === "string" ? createClient({ url: database }) : database;

    this.search = options?.search ?? false;
    this.searchContentFormatter = options?.searchContentFormatter ?? enhancedSearchContentFormatter;
  }

  /** Create a TursoWasmEventDatabase from a database and initialize it */
  static async fromClient(database: Client, options?: LibsqlEventDatabaseOptions): Promise<LibsqlEventDatabase> {
    const eventDatabase = new LibsqlEventDatabase(database, options);
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

  /** Remove multiple events that match the given filters */
  async removeByFilters(filters: FilterWithSearch | FilterWithSearch[]): Promise<number> {
    // If search is disabled, remove the search field from the filters
    if (this.search && (Array.isArray(filters) ? filters.some((f) => "search" in f) : "search" in filters))
      throw new Error("Cannot delete with search");

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
  close(): void {
    log("Closing database connection");
    this.db.close();
  }
  [Symbol.dispose]() {
    this.close();
  }
}
