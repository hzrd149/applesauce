import { IEventDatabase, logger } from "applesauce-core";
import { NostrEvent } from "applesauce-core/helpers";
import { DatabaseSync } from "node:sqlite";
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

const log = logger.extend("NativeSqliteEventDatabase");

/** Options for the {@link NativeSqliteEventDatabase} */
export type NativeSqliteEventDatabaseOptions = {
  search?: boolean;
  searchContentFormatter?: SearchContentFormatter;
};

export class NativeSqliteEventDatabase implements IEventDatabase {
  db: DatabaseSync;

  /** If search is enabled */
  private search: boolean;
  /** The search content formatter */
  private searchContentFormatter: SearchContentFormatter;

  constructor(database: string | DatabaseSync = ":memory:", options?: NativeSqliteEventDatabaseOptions) {
    this.db = typeof database === "string" ? new DatabaseSync(database) : database;

    this.search = options?.search ?? false;
    this.searchContentFormatter = options?.searchContentFormatter ?? enhancedSearchContentFormatter;

    // Setup the database tables and indexes
    createTables(this.db, this.search);
  }

  /** Store a Nostr event in the database */
  add(event: NostrEvent): NostrEvent {
    try {
      insertEvent(this.db, event, this.search ? this.searchContentFormatter : undefined);
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

  /** Remove multiple events that match the given filters */
  removeByFilters(filters: FilterWithSearch | FilterWithSearch[]): number {
    // If search is disabled, remove the search field from the filters
    if (this.search && (Array.isArray(filters) ? filters.some((f) => "search" in f) : "search" in filters))
      throw new Error("Cannot delete with search");

    return deleteEventsByFilters(this.db, filters);
  }

  /** Checks if an event exists */
  hasEvent(id: string): boolean {
    return hasEvent(this.db, id);
  }
  /** Get an event by its ID */
  getEvent(id: string): NostrEvent | undefined {
    return getEvent(this.db, id);
  }

  /** Get the latest replaceable event For replaceable events (10000-19999 and 30000-39999), returns the most recent event */
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

  /** Get all events that match the filters (supports NIP-50 search field) */
  getByFilters(filters: FilterWithSearch | FilterWithSearch[]): NostrEvent[] {
    // If search is disabled, remove the search field from the filters
    if (!this.search && (Array.isArray(filters) ? filters.some((f) => "search" in f) : "search" in filters))
      throw new Error("Search is disabled");

    return getEventsByFilters(this.db, filters);
  }
  /** Get a timeline of events that match the filters (returns array in chronological order, supports NIP-50 search) */
  getTimeline(filters: FilterWithSearch | FilterWithSearch[]): NostrEvent[] {
    // No need to sort since query defaults to created_at descending order
    return this.getByFilters(filters);
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
  rebuildSearchIndex(): void {
    if (!this.search) throw new Error("Search is disabled");

    rebuildSearchIndex(this.db, this.searchContentFormatter);
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
