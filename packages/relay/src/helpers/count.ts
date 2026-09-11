import type { RelayCountResponse } from "../types.js";

/**
 * NIP-45 COUNT payload validation and HyperLogLog utilities. A sketch is a fixed 256-register
 * HyperLogLog sent as one hex byte per register, so several relays' sketches can be merged and estimated
 * as one deduplicated set.
 */

/** The number of hex characters in a NIP-45 HLL sketch — one byte per each of the 256 registers. */
const HLL_HEX_LENGTH = 512;

/**
 * Thrown when a relay's COUNT payload or an HLL sketch is malformed. Lets a caller tell a protocol
 * violation apart from a transport or timeout failure.
 */
export class RelayCountResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayCountResponseError";
  }
}

/**
 * Decodes a hex sketch into its 256 register values. Rejects any value that is not exactly
 * {@link HLL_HEX_LENGTH} hex characters, which would otherwise decode to partly-`NaN` registers.
 */
function decodeHll(value: string): Uint8Array {
  if (typeof value !== "string" || value.length !== HLL_HEX_LENGTH || !/^[0-9a-f]+$/i.test(value))
    throw new RelayCountResponseError("Invalid NIP-45 HLL value");

  const registers = new Uint8Array(256);
  for (let i = 0; i < registers.length; i++) registers[i] = Number.parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return registers;
}

/** Encodes 256 register values back into the lowercase, zero-padded hex string NIP-45 puts on the wire. */
function encodeHll(registers: Uint8Array): string {
  return Array.from(registers, (value) => value.toString(16).padStart(2, "0")).join("");
}

/**
 * Validates a relay's COUNT payload into a normalized, prototype-pollution-safe copy that preserves
 * unknown keys. Throws {@link RelayCountResponseError} on any violation.
 */
export function parseRelayCountResponse(value: unknown): RelayCountResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new RelayCountResponseError("COUNT response must be an object");

  const source = value as Record<string, unknown>;
  if (!Object.hasOwn(source, "count") || !Number.isSafeInteger(source.count) || (source.count as number) < 0)
    throw new RelayCountResponseError("COUNT response count must be a non-negative safe integer");
  if (Object.hasOwn(source, "approximate") && typeof source.approximate !== "boolean")
    throw new RelayCountResponseError("COUNT response approximate must be boolean");
  if (Object.hasOwn(source, "hll") && typeof source.hll !== "string")
    throw new RelayCountResponseError("COUNT response hll must be a string");

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(source))
    Object.defineProperty(result, key, { value: source[key], enumerable: true, writable: true, configurable: true });
  result.count = source.count;
  if (typeof source.approximate === "boolean") result.approximate = source.approximate;
  if (typeof source.hll === "string") result.hll = encodeHll(decodeHll(source.hll));
  return result as RelayCountResponse;
}

/**
 * Merges several relays' sketches for the same filter by taking the per-register maximum, so the result
 * represents their deduplicated union. Throws {@link RelayCountResponseError} if `values` is empty or any
 * sketch is invalid.
 */
export function mergeHllRegisters(values: Iterable<string>): string {
  const merged = new Uint8Array(256);
  let seen = false;
  for (const value of values) {
    const registers = decodeHll(value);
    seen = true;
    for (let i = 0; i < merged.length; i++) merged[i] = Math.max(merged[i], registers[i]);
  }
  if (!seen) throw new RelayCountResponseError("At least one HLL value is required");
  return encodeHll(merged);
}

/**
 * Estimates how many distinct events a sketch represents, using linear counting in the small-cardinality
 * range where the raw estimator is biased. Returns a fractional estimate accurate to within a few
 * percent, not an exact count.
 */
export function estimateHllCardinality(hll: string): number {
  const registers = decodeHll(hll);
  const m = registers.length;
  let sum = 0;
  let zeros = 0;
  for (const register of registers) {
    sum += 2 ** -register;
    if (register === 0) zeros++;
  }
  const raw = ((0.7213 / (1 + 1.079 / m)) * m * m) / sum;
  return raw <= 2.5 * m && zeros > 0 ? m * Math.log(m / zeros) : raw;
}
