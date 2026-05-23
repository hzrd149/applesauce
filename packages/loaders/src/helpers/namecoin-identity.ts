/**
 * NIP-05 over Namecoin (`.bit`) identity helpers.
 *
 * Companion to {@link ./dns-identity} that parses NIP-05 identifiers rooted in
 * the Namecoin blockchain rather than DNS. These helpers are transport-free:
 * they parse the identifier and the raw Namecoin name-value JSON, but do
 * **not** open any sockets. Callers wire up an ElectrumX (WSS / TCP+TLS)
 * transport themselves via {@link ../loaders/namecoin-identity-loader.NamecoinIdentityLoader#resolve}.
 *
 * Accepted identifiers:
 *
 * - `alice@example.bit`
 * - `example.bit` (uses the `_` root entry)
 * - `d/example` (domain namespace, root)
 * - `id/alice` (identity namespace)
 * - A leading `nostr:` NIP-21 prefix is tolerated on any of the above.
 *
 * Local-part priority when scanning a `nostr.names` map: exact match → `_` →
 * first valid entry (only when the identifier targets the root `_`).
 *
 * See {@link https://github.com/nostr-protocol/nips/pull/2349 nostr-protocol/nips#2349}
 * for the draft spec. Parser semantics ported from the rust-nostr
 * `nip05namecoin` module, itself a port of the Kotlin (Amethyst) and Swift
 * (Nostur) reference implementations.
 */

import { sha256 } from "@noble/hashes/sha2";
import { unixNow } from "applesauce-core/helpers";

import {
  DomainIdentityJson,
  ErrorIdentity,
  Identity,
  IdentityStatus,
  KnownIdentity,
  MissingIdentity,
} from "./dns-identity.js";

// -----------------------------------------------------------------------------
// Re-exported identity types (reusing the DNS shape keeps consumers ergonomic).
// -----------------------------------------------------------------------------

export { IdentityStatus };
export type { DomainIdentityJson, ErrorIdentity, Identity, KnownIdentity, MissingIdentity };

// -----------------------------------------------------------------------------
// ElectrumX defaults
// -----------------------------------------------------------------------------

/** A Namecoin ElectrumX server endpoint pair. */
export type ElectrumxServer = {
  /** Hostname (or IP) of the operator. */
  host: string;
  /** TCP + TLS port. ElectrumX convention is `5xxx2`. */
  portTcpTls: number;
  /** WebSocket Secure port. ElectrumX convention is `5xxx4` (TCP+TLS+2). */
  portWss: number;
};

/**
 * Default ElectrumX server endpoints maintained by the Namecoin ecosystem.
 *
 * Mirrors the Kotlin / Swift / Go / Rust reference implementations. Operators
 * currently serve self-signed TLS certificates; callers that pin those
 * certificates should ship them out of band — this module keeps no transport
 * surface so it does not ship pinned PEMs.
 */
export const DEFAULT_ELECTRUMX_SERVERS: readonly ElectrumxServer[] = Object.freeze([
  { host: "electrumx.testls.space", portTcpTls: 50002, portWss: 50004 },
  { host: "nmc2.bitcoins.sk", portTcpTls: 57002, portWss: 57004 },
  { host: "46.229.238.187", portTcpTls: 57002, portWss: 57004 },
]);

// -----------------------------------------------------------------------------
// Identifier parsing
// -----------------------------------------------------------------------------

/** A parsed Namecoin identifier ready to be queried against the Namecoin blockchain. */
export type NamecoinAddress = {
  /** The Namecoin name to look up on-chain (e.g. `d/example` or `id/alice`). */
  namecoinName: string;
  /** Local-part to match inside the name's value, or `_` for the root entry. */
  localPart: string;
  /** `true` for the `d/` domain namespace, `false` for the `id/` identity namespace. */
  isDomain: boolean;
};

function stripNostrPrefix(s: string): string {
  return s.length >= 6 && s.slice(0, 6).toLowerCase() === "nostr:" ? s.slice(6) : s;
}

/**
 * Reports whether an identifier should be routed to Namecoin resolution
 * instead of DNS-based NIP-05.
 *
 * This is intentionally cheap so callers can use it as a front-door check in
 * hot paths before opening any network connection. Strict validation happens
 * in {@link parseNamecoinAddress}.
 */
export function isNamecoinIdentifier(identifier: string): boolean {
  if (typeof identifier !== "string") return false;
  const trimmed = identifier.trim();
  if (!trimmed) return false;
  const stripped = stripNostrPrefix(trimmed).toLowerCase();
  if (stripped.startsWith("d/") || stripped.startsWith("id/")) return true;
  return stripped.endsWith(".bit");
}

/** Alias for {@link isNamecoinIdentifier} kept for callers that prefer the descriptive name. */
export const isDotBit = isNamecoinIdentifier;

/**
 * Parse a Namecoin identifier (e.g. `alice@example.bit`, `example.bit`,
 * `d/example`, `id/alice`). Returns `null` if the input cannot be parsed.
 */
export function parseNamecoinAddress(identifier: string): NamecoinAddress | null {
  if (typeof identifier !== "string") return null;
  const input = stripNostrPrefix(identifier.trim());
  if (!input) return null;
  const lower = input.toLowerCase();

  // Explicit namespace references: d/<name>
  if (lower.startsWith("d/")) {
    const rest = lower.slice(2);
    if (!rest) return null;
    return { namecoinName: lower, localPart: "_", isDomain: true };
  }

  // Explicit namespace references: id/<name>
  if (lower.startsWith("id/")) {
    const rest = lower.slice(3);
    if (!rest) return null;
    return { namecoinName: lower, localPart: "_", isDomain: false };
  }

  // NIP-05 shape: user@domain.bit
  if (input.includes("@") && lower.endsWith(".bit")) {
    const at = input.indexOf("@");
    const localRaw = input.slice(0, at);
    const domainRaw = input.slice(at + 1);
    const local = localRaw === "" ? "_" : localRaw.toLowerCase();
    const domainLower = domainRaw.toLowerCase();
    if (!domainLower.endsWith(".bit")) return null;
    const domain = domainLower.slice(0, -".bit".length);
    if (!domain) return null;
    return { namecoinName: `d/${domain}`, localPart: local, isDomain: true };
  }

  // Bare domain: example.bit
  if (lower.endsWith(".bit")) {
    const domain = lower.slice(0, -".bit".length);
    if (!domain) return null;
    return { namecoinName: `d/${domain}`, localPart: "_", isDomain: true };
  }

  return null;
}

/** Re-derive the friendly display form of a parsed address. */
export function formatNamecoinAddress(address: NamecoinAddress): string {
  if (address.isDomain) {
    const bare = address.namecoinName.startsWith("d/") ? address.namecoinName.slice(2) : address.namecoinName;
    if (address.localPart === "_") return `${bare}.bit`;
    return `${address.localPart}@${bare}.bit`;
  }
  return address.namecoinName;
}

// -----------------------------------------------------------------------------
// JSON extraction
// -----------------------------------------------------------------------------

const HEX64_RE = /^[0-9a-f]{64}$/i;

function isHexPubkey(value: unknown): value is string {
  return typeof value === "string" && HEX64_RE.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// Import-chain resolution (ifa-0001 §"import")
// -----------------------------------------------------------------------------

/**
 * The minimum recursion depth ifa-0001 requires implementations to support
 * for the `"import"` directive.
 *
 * The spec mandates support for chains "at least four deep"; the default
 * here pins that lower bound. Deeper chains are silently truncated by
 * {@link expandImports} (the importing record's own items still apply).
 */
export const DEFAULT_IMPORT_DEPTH = 4;

/**
 * Async lookup callback used by {@link expandImports}. Should return the raw
 * Namecoin name-value JSON string for the supplied name, or `null` when the
 * name does not exist / cannot be fetched.
 *
 * Thrown errors are absorbed by {@link expandImports} so transient transport
 * failures during a sub-import never nuke the importing record.
 */
export type NamecoinValueFetcher = (namecoinName: string) => Promise<string | null>;

type ImportOp = {
  /** Namecoin name to import (e.g. `d/foo`). */
  name: string;
  /** DNS-dotted subdomain selector inside the imported value. May be empty. */
  selector: string;
};

function parseImportItem(item: unknown): ImportOp[] | null {
  // Shorthand: bare string -> single import with no selector.
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!trimmed) return null;
    return [{ name: trimmed, selector: "" }];
  }
  if (!Array.isArray(item)) return null;
  if (item.length === 0) return [];

  // Distinguish canonical array-of-arrays from shorthand array-of-strings.
  if (Array.isArray(item[0])) {
    const ops: ImportOp[] = [];
    for (const entry of item) {
      if (!Array.isArray(entry)) continue;
      const op = opFromArray(entry);
      if (op) ops.push(op);
    }
    return ops;
  }
  const op = opFromArray(item);
  return op ? [op] : [];
}

function opFromArray(arr: unknown[]): ImportOp | null {
  if (arr.length === 0) return null;
  const first = arr[0];
  if (typeof first !== "string") return null;
  const name = first.trim();
  if (!name) return null;
  let selector = "";
  if (arr.length >= 2) {
    const second = arr[1];
    if (typeof second !== "string") return null;
    selector = second.trim();
  }
  // Trailing dot is forbidden by spec; treat as malformed -> no selector.
  if (selector.endsWith(".")) return null;
  return { name, selector };
}

/**
 * Walk a DNS-dotted `selector` into the imported value's `map` tree per
 * ifa-0001 §"map". Returns the addressed node, or `null` if no match exists.
 *
 * Resolution rules per label, in order: exact match → `*` wildcard → `""`
 * default. A non-object child terminates the walk with `null`.
 */
function applySelector(root: Record<string, unknown>, selector: string): Record<string, unknown> | null {
  if (!selector) return root;
  // DNS dotted: leftmost label is the most-specific, so walk right-to-left.
  const labels = selector
    .split(".")
    .filter((l) => l.length > 0)
    .reverse();
  if (labels.length === 0) return root;

  let current: Record<string, unknown> = root;
  for (const label of labels) {
    const map = current.map;
    if (!isPlainObject(map)) return null;
    const exact = map[label];
    if (isPlainObject(exact)) {
      current = exact;
      continue;
    }
    const wildcard = map["*"];
    if (isPlainObject(wildcard)) {
      current = wildcard;
      continue;
    }
    const fallback = map[""];
    if (isPlainObject(fallback)) {
      current = fallback;
      continue;
    }
    return null;
  }
  return current;
}

function tryParseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function omitImportKey(obj: Record<string, unknown>): Record<string, unknown> {
  if (!("import" in obj)) return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== "import") out[k] = v;
  }
  return out;
}

/**
 * Merge `imported` underneath `importer` with importer-wins precedence per
 * ifa-0001. Keys present in `importer` (including `null` values, which act
 * as semantic suppression markers) override imported keys; remaining
 * imported keys fill in.
 */
function mergeImporterWins(
  importer: Record<string, unknown>,
  imported: Record<string, unknown>,
): Record<string, unknown> {
  if (Object.keys(imported).length === 0) return importer;
  if (Object.keys(importer).length === 0) return imported;
  const out: Record<string, unknown> = {};
  // Imported first so importer can overwrite.
  for (const [k, v] of Object.entries(imported)) out[k] = v;
  for (const [k, v] of Object.entries(importer)) out[k] = v;
  return out;
}

/**
 * Recursively resolve the [`"import"`][ifa-0001] directive on a parsed
 * Namecoin name value, merging the imported names' contents into the
 * importing object before downstream extractors (e.g. {@link extractNostrFromValue})
 * see it.
 *
 * Per [ifa-0001](https://github.com/namecoin/proposals/blob/master/ifa-0001.md)
 * §"import":
 *
 * - The importing object's items take precedence over imported items. A
 *   `null` value in the importer is still "present" and so suppresses the
 *   corresponding imported item.
 * - The canonical `"import"` value is an array of arrays. Three shorthand
 *   forms are also accepted (and common in real-world records):
 *   - `"import": "d/foo"` ↔ `[["d/foo"]]`
 *   - `"import": ["d/foo"]` ↔ `[["d/foo"]]`
 *   - `"import": ["d/foo", "sub"]` ↔ `[["d/foo", "sub"]]`
 * - The optional second element of each import is a DNS-dotted Subdomain
 *   Selector that addresses a node inside the imported value's `map` tree.
 * - Imports listed in the same array are merged left-to-right (later wins);
 *   the importing object is then stacked on top of all of them.
 * - The implementation supports the spec-mandated minimum recursion depth
 *   of {@link DEFAULT_IMPORT_DEPTH}. Deeper chains are silently truncated.
 * - Cycles are broken via a visited-set keyed on `name|selector`.
 * - A failed import (lookup returns `null`, throws, or returns malformed
 *   JSON) is treated as the empty object `{}` rather than failing the
 *   whole record — matching this package's existing best-effort policy for
 *   transient ElectrumX failures.
 *
 * If `value` has no `"import"` key, it is returned unchanged with zero extra
 * I/O. The `"import"` key is stripped from the returned object.
 */
export async function expandImports(
  value: Record<string, unknown>,
  lookup: NamecoinValueFetcher,
  maxDepth: number = DEFAULT_IMPORT_DEPTH,
): Promise<Record<string, unknown>> {
  if (!("import" in value)) return value;
  return await expandRecursive(value, lookup, maxDepth, new Set<string>());
}

async function expandRecursive(
  obj: Record<string, unknown>,
  lookup: NamecoinValueFetcher,
  budgetRemaining: number,
  visited: Set<string>,
): Promise<Record<string, unknown>> {
  const item = obj.import;
  if (item === undefined) return obj;
  const ops = parseImportItem(item);
  if (!ops || ops.length === 0 || budgetRemaining <= 0) return omitImportKey(obj);

  let accumulator: Record<string, unknown> = {};
  for (const op of ops) {
    const visitKey = `${op.name}|${op.selector}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    try {
      let raw: string | null;
      try {
        raw = await lookup(op.name);
      } catch {
        raw = null;
      }
      if (raw == null) continue;
      const importedRoot = tryParseObject(raw);
      if (!importedRoot) continue;
      const selectorView = applySelector(importedRoot, op.selector);
      if (!selectorView) continue;
      const expanded = await expandRecursive(selectorView, lookup, budgetRemaining - 1, visited);
      accumulator = mergeImporterWins(expanded, accumulator);
    } finally {
      visited.delete(visitKey);
    }
  }

  const withoutImport = omitImportKey(obj);
  return mergeImporterWins(withoutImport, accumulator);
}

/** The shape of the `nostr` field in an extended Namecoin name value. */
export type NamecoinNostrValue = {
  pubkey: string;
  relays?: string[];
  nip46?: string[];
};

function extractRelaysFor(obj: Record<string, unknown>, pubkey: string): string[] | undefined {
  const relays = obj.relays;
  if (!isPlainObject(relays)) return undefined;
  const list = relays[pubkey.toLowerCase()];
  if (Array.isArray(list) && list.every((r) => typeof r === "string")) {
    return list.length > 0 ? (list as string[]) : undefined;
  }
  return undefined;
}

function extractNip46For(obj: Record<string, unknown>, pubkey: string): string[] | undefined {
  const nip46 = obj.nip46;
  if (!isPlainObject(nip46)) return undefined;
  const list = nip46[pubkey.toLowerCase()];
  if (Array.isArray(list) && list.every((r) => typeof r === "string")) {
    return list.length > 0 ? (list as string[]) : undefined;
  }
  return undefined;
}

function extractFromDomainNamesObject(
  obj: Record<string, unknown>,
  address: NamecoinAddress,
): NamecoinNostrValue | null {
  const names = obj.names;
  if (!isPlainObject(names)) return null;

  // Match priority: exact local-part → "_" → first valid entry (only when
  // the caller asked for the root). Matches the Kotlin / Rust reference.
  let picked: string | undefined;
  const exact = names[address.localPart];
  if (isHexPubkey(exact)) picked = exact;
  if (!picked) {
    const root = names["_"];
    if (isHexPubkey(root)) picked = root;
  }
  if (!picked && address.localPart === "_") {
    for (const candidate of Object.values(names)) {
      if (isHexPubkey(candidate)) {
        picked = candidate;
        break;
      }
    }
  }

  if (!picked) return null;
  const lowered = picked.toLowerCase();
  const relays = extractRelaysFor(obj, lowered);
  const nip46 = extractNip46For(obj, lowered);
  return { pubkey: lowered, relays, nip46 };
}

function extractFromIdentityObject(obj: Record<string, unknown>): NamecoinNostrValue | null {
  // Prefer the `pubkey` field for the identity namespace.
  const pk = obj.pubkey;
  if (isHexPubkey(pk)) {
    const lowered = pk.toLowerCase();
    let relays: string[] | undefined;
    if (Array.isArray(obj.relays) && obj.relays.every((r) => typeof r === "string")) {
      relays = (obj.relays as string[]).length > 0 ? (obj.relays as string[]) : undefined;
    } else {
      relays = extractRelaysFor(obj, lowered);
    }
    let nip46: string[] | undefined;
    if (Array.isArray(obj.nip46) && obj.nip46.every((r) => typeof r === "string")) {
      nip46 = (obj.nip46 as string[]).length > 0 ? (obj.nip46 as string[]) : undefined;
    } else {
      nip46 = extractNip46For(obj, lowered);
    }
    return { pubkey: lowered, relays, nip46 };
  }

  // Fall back to a NIP-05-style `names` map with the `_` root entry.
  const names = obj.names;
  if (isPlainObject(names)) {
    const root = names["_"];
    if (isHexPubkey(root)) {
      const lowered = root.toLowerCase();
      return { pubkey: lowered, relays: extractRelaysFor(obj, lowered), nip46: extractNip46For(obj, lowered) };
    }
  }

  return null;
}

/**
 * Extract the nostr pubkey + relay list from a parsed Namecoin name value.
 *
 * Supports both the simple `"nostr": "hex"` form and the extended
 * `"nostr": { "names": {...}, "relays": {...}, "nip46": {...} }` form used
 * by Amethyst and the `.bit` NIP-05 spec draft. Returns `null` if the value
 * does not encode a verifiable Nostr identity for `address`.
 */
export function extractNostrFromValue(address: NamecoinAddress, json: unknown): NamecoinNostrValue | null {
  if (!isPlainObject(json)) return null;
  const nostrField = json.nostr;
  if (nostrField === undefined) return null;

  // Simple form: "nostr": "hex-pubkey"
  if (typeof nostrField === "string") {
    // Simple form has no local-part addressing.
    if (address.isDomain && address.localPart !== "_") return null;
    if (!isHexPubkey(nostrField)) return null;
    return { pubkey: nostrField.toLowerCase() };
  }

  if (!isPlainObject(nostrField)) return null;
  return address.isDomain ? extractFromDomainNamesObject(nostrField, address) : extractFromIdentityObject(nostrField);
}

// -----------------------------------------------------------------------------
// Identity construction (reuses the dns-identity Identity shape).
// -----------------------------------------------------------------------------

/**
 * Builds an {@link Identity} from a parsed Namecoin address and the raw name
 * value JSON. The `domain` field on the returned identity carries the
 * Namecoin name (e.g. `d/example`, `id/alice`); `name` carries the local-part.
 */
export function getIdentityFromNamecoinValue(
  address: NamecoinAddress,
  json: unknown,
  checked: number = unixNow(),
): KnownIdentity | MissingIdentity {
  const common = { name: address.localPart, domain: address.namecoinName, checked };
  const extracted = extractNostrFromValue(address, json);
  if (!extracted) return { ...common, status: IdentityStatus.Missing };
  return {
    ...common,
    status: IdentityStatus.Found,
    pubkey: extracted.pubkey,
    relays: extracted.relays,
    hasNip46: extracted.nip46 !== undefined,
    nip46Relays: extracted.nip46,
  };
}

// -----------------------------------------------------------------------------
// Namecoin script + ElectrumX scripthash helpers
// -----------------------------------------------------------------------------

const OP_NAME_UPDATE = 0x53; // OP_3, repurposed as OP_NAME_UPDATE in the Namecoin fork
const OP_2DROP = 0x6d;
const OP_DROP = 0x75;
const OP_RETURN = 0x6a;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;

function pushData(out: number[], data: Uint8Array | number[]): void {
  const n = data.length;
  if (n < OP_PUSHDATA1) {
    out.push(n & 0xff);
    for (let i = 0; i < n; i++) out.push(data[i]);
    return;
  }
  if (n <= 0xff) {
    out.push(OP_PUSHDATA1, n & 0xff);
    for (let i = 0; i < n; i++) out.push(data[i]);
    return;
  }
  if (n <= 0xffff) {
    out.push(OP_PUSHDATA2, n & 0xff, (n >> 8) & 0xff);
    for (let i = 0; i < n; i++) out.push(data[i]);
    return;
  }
  out.push(OP_PUSHDATA4, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
  for (let i = 0; i < n; i++) out.push(data[i]);
}

/**
 * Build the canonical name-index script used by the Namecoin ElectrumX fork.
 *
 * Format: `OP_NAME_UPDATE <push(name)> <push(empty)> OP_2DROP OP_DROP OP_RETURN`.
 *
 * The resulting script's SHA-256, reversed and hex-encoded, is the scripthash
 * queried via `blockchain.scripthash.get_history`. See {@link electrumScriptHash}.
 */
export function buildNameIndexScript(name: Uint8Array): Uint8Array {
  const out: number[] = [];
  out.push(OP_NAME_UPDATE);
  pushData(out, name);
  pushData(out, []);
  out.push(OP_2DROP);
  out.push(OP_DROP);
  out.push(OP_RETURN);
  return new Uint8Array(out);
}

const HEX_DIGITS = "0123456789abcdef";

/**
 * Compute the Electrum scripthash: SHA-256 of `script`, byte-reversed, then
 * hex-encoded. Expected by `blockchain.scripthash.get_history` and friends.
 */
export function electrumScriptHash(script: Uint8Array): string {
  const digest = sha256(script);
  let s = "";
  // Reverse + hex in one pass.
  for (let i = digest.length - 1; i >= 0; i--) {
    const b = digest[i];
    s += HEX_DIGITS[b >> 4];
    s += HEX_DIGITS[b & 0x0f];
  }
  return s;
}

function readPushData(script: Uint8Array, pos: number): { data: Uint8Array; next: number } | null {
  if (pos >= script.length) return null;
  const op = script[pos];
  if (op === 0x00) {
    return { data: script.subarray(pos, pos), next: pos + 1 };
  }
  if (op < OP_PUSHDATA1) {
    const end = pos + 1 + op;
    if (end > script.length) return null;
    return { data: script.subarray(pos + 1, end), next: end };
  }
  if (op === OP_PUSHDATA1) {
    if (pos + 2 > script.length) return null;
    const length = script[pos + 1];
    const end = pos + 2 + length;
    if (end > script.length) return null;
    return { data: script.subarray(pos + 2, end), next: end };
  }
  if (op === OP_PUSHDATA2) {
    if (pos + 3 > script.length) return null;
    const length = script[pos + 1] | (script[pos + 2] << 8);
    const end = pos + 3 + length;
    if (end > script.length) return null;
    return { data: script.subarray(pos + 3, end), next: end };
  }
  if (op === OP_PUSHDATA4) {
    if (pos + 5 > script.length) return null;
    const length = script[pos + 1] | (script[pos + 2] << 8) | (script[pos + 3] << 16) | (script[pos + 4] << 24);
    const end = pos + 5 + length;
    if (end > script.length) return null;
    return { data: script.subarray(pos + 5, end), next: end };
  }
  return null;
}

/**
 * Parse a Namecoin `NAME_UPDATE` output script and return `{ name, value }`.
 *
 * Layout: `OP_NAME_UPDATE <push(name)> <push(value)> OP_2DROP OP_DROP <address-script>`.
 *
 * The trailing address-paying script is ignored. Returns `null` if the script
 * cannot be decoded.
 */
export function parseNameUpdateScript(script: Uint8Array): { name: Uint8Array; value: Uint8Array } | null {
  if (script.length === 0 || script[0] !== OP_NAME_UPDATE) return null;
  const namePush = readPushData(script, 1);
  if (!namePush) return null;
  const valuePush = readPushData(script, namePush.next);
  if (!valuePush) return null;
  // Return copies so callers can mutate freely without disturbing the source.
  return { name: new Uint8Array(namePush.data), value: new Uint8Array(valuePush.data) };
}
