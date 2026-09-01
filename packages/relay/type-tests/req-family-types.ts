import { Relay } from "../src/relay.js";
import { RelayGroup } from "../src/group.js";
import { RelayPool } from "../src/pool.js";

declare const relay: Relay;
declare const group: RelayGroup;
declare const pool: RelayPool;

relay.req({}, { id: "raw" });
relay.request({}, { id: "finite", reconnect: true, resubscribe: 2, timeout: 100, authRetries: 1 });
relay.subscription({}, { id: "persistent", reconnect: true, resubscribe: 2, authRetries: 1 });
group.req({}, { id: "raw" });
group.request({}, { timeout: 100, eventStore: null });
group.subscription({}, { eventStore: null });

// @ts-expect-error raw REQ owns no auth policy
relay.req({}, { waitForAuth: true });
// @ts-expect-error raw REQ owns no reconnect policy
relay.req({}, { reconnect: true });
// @ts-expect-error raw REQ owns no repeat policy
group.req({}, { resubscribe: true });
// @ts-expect-error subscriptions have no built-in timeout
relay.subscription({}, { timeout: 100 });
// @ts-expect-error group subscriptions have no built-in timeout
group.subscription({}, { timeout: 100 });
// @ts-expect-error pool subscriptions derive the no-timeout group surface
pool.subscription([], {}, { timeout: 100 });
// @ts-expect-error mapped pool subscriptions derive the no-timeout group surface
pool.subscriptionMap({}, { timeout: 100 });
// @ts-expect-error outbox pool subscriptions derive the no-timeout group surface
pool.outboxSubscription({}, {}, { timeout: 100 });
