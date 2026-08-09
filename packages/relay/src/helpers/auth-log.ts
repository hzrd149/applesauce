import type { Filter } from "applesauce-core/helpers/filter";

import type { AuthRequirement, RelayAuthWireRequest } from "../types.js";

/**
 * Internal-only D-06/T-14-01 formatter module. Imports only types from `../types.js` so it carries no
 * runtime dependency on `relay.ts` — mirrors `operators/auth-retry.ts`'s internal-only, one-way-dependency
 * precedent. Not barrel-exported from `index.ts`/`operators/index.ts`.
 */

/** Maximum length of a relay-supplied free-text value before it is truncated for a log line (T-14-01) */
export const AUTH_LOG_TEXT_LIMIT = 256;
/** Number of leading characters of an id kept for a display-only, still-greppable prefix */
export const AUTH_LOG_ID_LENGTH = 8;
/** Maximum number of a filter's `kinds` spelled out before the rest collapse into an elision marker (D-06) */
export const AUTH_LOG_KINDS_LIMIT = 20;

const EMPTY_FILTER_PLACEHOLDER = "(empty filter)";
const EMPTY_FILTERS_PLACEHOLDER = "(no filters)";

/**
 * Bounds a relay-supplied free-text value (`reason`, `message`, `challenge`) at `limit` characters before
 * it is interpolated into a log line (T-14-01, the DoS mitigation for T-14-01). Coerces a non-string value
 * to a string, using an empty string for `null`/`undefined`. A string no longer than `limit` is returned
 * unchanged; a longer one is cut to `limit` characters with a suffix naming how many characters were dropped.
 */
export function truncateForLog(value: unknown, limit: number = AUTH_LOG_TEXT_LIMIT): string {
  const text = value === null || value === undefined ? "" : String(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}…(+${text.length - limit} more chars)`;
}

/**
 * Returns the leading `length` characters of `id` (unchanged if already shorter) — a display-only prefix
 * that still greps against the relay's own server log.
 */
export function shortId(id: string, length: number = AUTH_LOG_ID_LENGTH): string {
  return id.length <= length ? id : id.slice(0, length);
}

/** Formats a list of filter kinds spelled out up to {@link AUTH_LOG_KINDS_LIMIT}, with a trailing elision marker naming how many more were dropped (D-06) */
function formatKinds(kinds: readonly number[]): string {
  const capped = kinds.slice(0, AUTH_LOG_KINDS_LIMIT);
  const elided = kinds.length - capped.length;
  return elided > 0 ? `[${capped.join(",")},+${elided} more]` : `[${capped.join(",")}]`;
}

/**
 * Renders one filter as space-joined `key=value` pairs — `kinds` spelled out first when present (capped
 * per D-06), then every other key in its own key order. Only `kinds`/`limit`/`since`/`until` print a
 * value directly; `search` prints its character count (never its text); every other key — `ids`,
 * `authors`, any `#`-prefixed tag key, and any unknown key — prints the array length when the value is an
 * array and `1` otherwise. An object with no keys renders as a fixed placeholder rather than an empty
 * string.
 */
export function summarizeFilter(filter: Filter): string {
  const keys = Object.keys(filter);
  if (keys.length === 0) return EMPTY_FILTER_PLACEHOLDER;

  const record = filter as Record<string, unknown>;
  const parts: string[] = [];

  if (keys.includes("kinds")) parts.push(`kinds=${formatKinds((record.kinds as number[] | undefined) ?? [])}`);

  for (const key of keys) {
    if (key === "kinds") continue;
    const value = record[key];
    if (key === "limit" || key === "since" || key === "until") parts.push(`${key}=${value}`);
    else if (key === "search") parts.push(`${key}=${String(value).length}chars`);
    else parts.push(`${key}=${Array.isArray(value) ? value.length : 1}`);
  }

  return parts.join(" ");
}

/**
 * Summarizes a filter array — a fixed placeholder for an empty array, delegates to {@link summarizeFilter}
 * for a single-element array, and for two or more filters returns the filter count followed by the
 * deduplicated first-seen-order union of every filter's declared `kinds` (capped the same way as
 * {@link summarizeFilter}), or just the count when no filter declares `kinds`.
 */
export function summarizeFilters(filters: Filter[]): string {
  if (filters.length === 0) return EMPTY_FILTERS_PLACEHOLDER;
  if (filters.length === 1) return summarizeFilter(filters[0]);

  const kinds: number[] = [];
  const seen = new Set<number>();
  for (const filter of filters) {
    const filterKinds = (filter as { kinds?: number[] }).kinds;
    if (!filterKinds) continue;
    for (const kind of filterKinds) {
      if (!seen.has(kind)) {
        seen.add(kind);
        kinds.push(kind);
      }
    }
  }

  const countLabel = `${filters.length} filters`;
  return kinds.length > 0 ? `${countLabel} kinds=${formatKinds(kinds)}` : countLabel;
}

/**
 * Renders what an operation is waiting for in prose — a boolean requirement as a phrase naming any
 * authenticated pubkey, a single pubkey as that pubkey, and an array as its comma-joined pubkeys.
 */
export function describeAuthRequirement(requirement: AuthRequirement): string {
  if (typeof requirement === "boolean") return "any authenticated pubkey";
  if (typeof requirement === "string") return requirement;
  return requirement.join(",");
}

/**
 * Renders the exact wire request a relay refused as a bounded, human-readable summary. The `default`
 * branch assigns the narrowed `request` to a `never`-typed local so a fifth {@link RelayAuthWireRequest}
 * member added later fails to typecheck here rather than silently falling through (D-02).
 */
export function describeWireRequest(request: RelayAuthWireRequest): string {
  switch (request.verb) {
    case "REQ":
    case "COUNT":
      return `${request.verb} ${shortId(request.id)} ${summarizeFilters(request.filters)}`;
    case "EVENT":
      return `${request.verb} ${shortId(request.event.id)} kind=${request.event.kind}`;
    case "NEG-OPEN":
      return `${request.verb} ${shortId(request.id)} ${summarizeFilters([request.filter])}`;
    default: {
      const exhaustive: never = request;
      throw new Error(`Unhandled wire request verb: ${JSON.stringify(exhaustive)}`);
    }
  }
}
