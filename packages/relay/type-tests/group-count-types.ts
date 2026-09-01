import type { RelayCountOutcomes, RelayCountResponse } from "../src/types.js";
import type { Relay } from "../src/relay.js";
import type { RelayGroup } from "../src/group.js";
import type { RelayPool } from "../src/pool.js";

declare const outcomes: RelayCountOutcomes;
declare const relay: Relay;
declare const group: RelayGroup;
declare const pool: RelayPool;
const outcome = outcomes["wss://relay.test/"];
if (outcome.ok) outcome.value satisfies RelayCountResponse;
else outcome.error satisfies unknown;
// @ts-expect-error aggregate entries require narrowing
outcome.count;
relay.count({}) satisfies ReturnType<Relay["count"]>;
pool.count([], {}) satisfies ReturnType<RelayGroup["count"]>;
