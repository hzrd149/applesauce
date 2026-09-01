import type { RelayOutcome } from "../src/types.js";
import { RelayGroup } from "../src/group.js";
import { RelayPool } from "../src/pool.js";

declare const outcome: RelayOutcome<number>;
if (outcome.ok) outcome.value satisfies number;
else outcome.error satisfies unknown;

declare const group: RelayGroup;
declare const pool: RelayPool;
group.request({}, { timeout: 100 });
pool.request([], {}, { timeout: 100 });

// @ts-expect-error timeout must be numeric
group.request({}, { timeout: "100" });
// @ts-expect-error subscriptions have no built-in timeout
group.subscription({}, { timeout: {} });
// @ts-expect-error pool forwarding preserves the no-timeout contract
pool.subscriptionMap({}, { timeout: true });
