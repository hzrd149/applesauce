import { NostrEvent } from "applesauce-core/helpers";
import { FilterWithSearch } from "./search.js";
import { EventRow } from "./statements.js";

/** Convert database row to NostrEvent */
export function rowToEvent(row: EventRow): NostrEvent {
  return {
    id: row.id,
    kind: row.kind,
    pubkey: row.pubkey,
    created_at: row.created_at,
    content: row.content,
    tags: JSON.parse(row.tags || "[]"),
    sig: row.sig,
  };
}

/** Builds conditions for a single filter */
export function buildFilterConditions(filter: FilterWithSearch): {
  conditions: string[];
  params: any[];
  search: boolean;
} {
  const conditions: string[] = [];
  const params: any[] = [];
  let search = false;

  // Handle NIP-50 search filter
  if (filter.search && filter.search.trim()) {
    conditions.push(`events_search MATCH ?`);
    params.push(filter.search.trim());
    search = true;
  }

  // Handle IDs filter
  if (filter.ids && filter.ids.length > 0) {
    const placeholders = filter.ids.map(() => `?`).join(", ");
    conditions.push(`events.id IN (${placeholders})`);
    params.push(...filter.ids);
  }

  // Handle kinds filter
  if (filter.kinds && filter.kinds.length > 0) {
    const placeholders = filter.kinds.map(() => `?`).join(", ");
    conditions.push(`events.kind IN (${placeholders})`);
    params.push(...filter.kinds);
  }

  // Handle authors filter (pubkeys)
  if (filter.authors && filter.authors.length > 0) {
    const placeholders = filter.authors.map(() => `?`).join(", ");
    conditions.push(`events.pubkey IN (${placeholders})`);
    params.push(...filter.authors);
  }

  // Handle since filter (timestamp >= since)
  if (filter.since !== undefined) {
    conditions.push(`events.created_at >= ?`);
    params.push(filter.since);
  }

  // Handle until filter (timestamp <= until)
  if (filter.until !== undefined) {
    conditions.push(`events.created_at <= ?`);
    params.push(filter.until);
  }

  // Handle tag filters (e.g., #e, #p, #t, #d, etc.)
  for (const [key, values] of Object.entries(filter)) {
    if (key.startsWith("#") && values && Array.isArray(values) && values.length > 0) {
      const tagName = key.slice(1); // Remove the '#' prefix

      // Use the event_tags table for efficient tag filtering
      const placeholders = values.map(() => "?").join(", ");
      conditions.push(`events.id IN (
        SELECT DISTINCT event_id
        FROM event_tags
        WHERE tag_name = ? AND tag_value IN (${placeholders})
      )`);

      // Add parameters: tagName first, then all the tag values
      params.push(tagName, ...values);
    }
  }

  return { conditions, params, search };
}

export function buildFiltersQuery(filters: FilterWithSearch | FilterWithSearch[]): {
  sql: string;
  params: any[];
} | null {
  const filterArray = Array.isArray(filters) ? filters : [filters];
  if (filterArray.length === 0) return null;

  // Build queries for each filter (OR logic between filters)
  const filterQueries: string[] = [];
  const allParams: any[] = [];
  let globalLimit: number | undefined;

  // Build the final query with proper ordering and limit
  let fromClause = "events";
  let orderBy = "events.created_at DESC, events.id ASC";

  for (const filter of filterArray) {
    const { conditions, params, search } = buildFilterConditions(filter);

    if (search) {
      // Override the from clause to join the events_search table
      fromClause = "events INNER JOIN events_search ON events.id = events_search.event_id";

      // Set the order by clause based on the filter order
      switch (filter.order) {
        case "created_at":
          orderBy = "events.created_at DESC, events.id ASC";
          break;
        case "rank":
          orderBy = "events_search.rank, events.created_at DESC";
          break;
      }
    }

    if (conditions.length === 0) {
      // If no conditions, this filter matches all events
      filterQueries.push("1=1");
    } else {
      // AND logic within a single filter
      filterQueries.push(`(${conditions.join(" AND ")})`);
    }

    allParams.push(...params);

    // Track the most restrictive limit across all filters
    if (filter.limit !== undefined) {
      globalLimit = globalLimit === undefined ? filter.limit : Math.min(globalLimit, filter.limit);
    }
  }

  // Combine all filter conditions with OR logic
  const whereClause = filterQueries.length > 0 ? `WHERE ${filterQueries.join(" OR ")}` : "";

  let query = `
      SELECT DISTINCT events.* FROM ${fromClause}
      ${whereClause}
      ORDER BY ${orderBy}
    `;

  // Apply global limit if specified
  if (globalLimit !== undefined && globalLimit > 0) {
    query += ` LIMIT ?`;
    allParams.push(globalLimit);
  }

  return { sql: query, params: allParams };
}
