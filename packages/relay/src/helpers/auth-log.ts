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
 * Matches ASCII control characters (0x00-0x1F) and DEL (0x7F) — see {@link truncateForLog} (CR-01).
 * Built from a string via the `RegExp` constructor (rather than a `/…/` regex literal embedding the raw
 * control-character range) so the pattern stays plain, greppable ASCII source text.
 */
const CONTROL_CHARS_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/**
 * Bounds a relay-supplied free-text value (`reason`, `message`, `challenge`) at `limit` characters before
 * it is interpolated into a log line (T-14-01, the DoS mitigation for T-14-01), and neutralizes it so it
 * can neither be interpreted as a `debug`/`util.format` specifier nor introduce a new physical line
 * (CR-01). Coerces a non-string value to a string, using an empty string for `null`/`undefined`. A string
 * no longer than `limit` (after neutralization) is returned unchanged; a longer one is cut to `limit`
 * characters with a suffix naming how many characters were dropped.
 *
 * CR-01: `debug` (`common.js`) treats the string handed to it as a printf-style format string — it runs a
 * `%`-replacement pass before `util.formatWithOptions` ever sees it. Every relay-controlled string that
 * reaches this function is later interpolated into that same first argument at its call site, so left
 * unneutralized a hostile relay can (1) destroy its own log line's content — `%o`/`%O` are real
 * `createDebug.formatters` entries that consume a non-existent argument and render `undefined` — or (2)
 * forge an entire extra physical line via an embedded newline, byte-identical to a genuine connection-track
 * line (CWE-117). Doubling `%` relies on this value always being interpolated into the format argument
 * (never passed as a separate `%s` argument) — drop the doubling if a sink is ever changed to do that.
 * Escaping control characters as `\xHH` (rather than deleting them) keeps the operator able to tell a
 * hostile value was received, while making it structurally impossible for it to start a new physical line.
 */
export function truncateForLog(value: unknown, limit: number = AUTH_LOG_TEXT_LIMIT): string {
  // WR-04: String(value) can throw (a poisoned Symbol.toPrimitive/toString) — at auth-retry.ts's two
  // handler-error call sites, `value` is whatever a caller's onAuthRequired threw/rejected with, so a
  // throw here would escape from inside a `catch`/inside a defer factory rather than being mapped to
  // AuthHandlerError, defeating CR-04's "both failure modes are indistinguishable to the caller"
  // invariant. A diagnostic formatter must degrade the line, never the operation.
  let raw: string;
  try {
    raw = value === null || value === undefined ? "" : String(value);
  } catch {
    raw = "(unstringifiable value)";
  }
  const text = raw
    .replace(/%/g, "%%")
    .replace(CONTROL_CHARS_RE, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
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

/**
 * Formats a list of filter kinds spelled out up to {@link AUTH_LOG_KINDS_LIMIT}, with a trailing elision
 * marker naming how many more were dropped (D-06). WR-04: accepts `unknown` and falls back to an empty
 * list for anything that is not actually an array — a filter is caller-supplied and only weakly typed
 * (`summarizeFilter`'s own cast doesn't guard a non-array `kinds`, e.g. `{ kinds: 1 }`), and this is
 * called from inside a socket `map`/`tap`, where a throw here would error the whole REQ/EVENT stream
 * before the auth-required signal it exists to help describe is ever returned.
 */
function formatKinds(kinds: unknown): string {
  const list: readonly number[] = Array.isArray(kinds) ? kinds : [];
  const capped = list.slice(0, AUTH_LOG_KINDS_LIMIT);
  const elided = list.length - capped.length;
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

  // WR-04: formatKinds itself guards non-array input (e.g. a caller-supplied { kinds: 1 }) — the old
  // `(record.kinds as number[] | undefined) ?? []` cast only caught undefined, not a truthy non-array.
  if (keys.includes("kinds")) parts.push(`kinds=${formatKinds(record.kinds)}`);

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
    // WR-04: Array.isArray, not just a truthiness check — a caller-supplied filter with a truthy
    // non-array kinds (e.g. { kinds: 1 }) would otherwise reach `for...of` on a non-iterable and throw,
    // erroring the whole REQ/COUNT/NEG-OPEN stream from inside a socket map/catchError.
    const filterKinds = (filter as { kinds?: unknown }).kinds;
    if (!Array.isArray(filterKinds)) continue;
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
 * member added later fails to typecheck here rather than silently falling through (D-02). WR-04: that
 * branch is unreachable through the type system today, but this function is called from inside a socket
 * `map`/`tap`/`catchError` at every one of its call sites in relay.ts — a future non-typechecked
 * construction site (e.g. a value crossing an untyped boundary) would turn a missed switch arm into a
 * thrown error that drops the whole subscription, rather than into a merely-imprecise log line. Degrades
 * to a fallback string instead of throwing, keeping the compile-time exhaustiveness guarantee without a
 * runtime one.
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
      return `UNKNOWN(${String((exhaustive as { verb?: unknown }).verb ?? "unknown")})`;
    }
  }
}
