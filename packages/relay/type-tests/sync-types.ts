import type { NostrEvent } from "applesauce-core/helpers";
import type { Observable } from "rxjs";

import { RelayGroup } from "../src/group.js";
import { RelayPool } from "../src/pool.js";
import { Relay, SyncDirection } from "../src/relay.js";
import type { GroupSyncMessage, NegentropyOptions, NegentropyRound, SyncMessage } from "../src/types.js";
// @ts-expect-error callback-era type was removed
import type { NegentropySyncOptions } from "../src/types.js";

declare const relay: Relay;
declare const group: RelayGroup;
declare const pool: RelayPool;
declare const events: NostrEvent[];

const rounds: Observable<NegentropyRound> = relay.negentropy(events, {}, { frameSizeLimit: 60_000 });
rounds.subscribe(({ have, need }) => [have, need] satisfies string[][]);

const options: NegentropyOptions = { id: "sync", frameSizeLimit: 60_000, signal: new AbortController().signal };
relay.negentropy(events, {}, options);

const relayResults: Observable<SyncMessage> = relay.sync(events, {}, SyncDirection.BOTH, { concurrency: 4 });
const groupResults: Observable<GroupSyncMessage> = group.sync(events, {}, SyncDirection.BOTH);
const poolResults: Observable<GroupSyncMessage> = pool.sync([], events, {}, SyncDirection.BOTH);
void relayResults;
void poolResults;

groupResults.subscribe((message) => {
  switch (message.type) {
    case "received":
    case "sent":
      message.event satisfies NostrEvent;
      break;
    case "send-failed":
    case "relay-failed":
      message.error satisfies unknown;
  }
});

// @ts-expect-error low-level reconciliation callbacks were removed
relay.negentropy(events, {}, async (_have: string[], _need: string[]) => {});
// @ts-expect-error Group exposes high-level sync only
group.negentropy(events, {});
// @ts-expect-error Pool exposes high-level sync only
pool.negentropy([], events, {});
// @ts-expect-error sync lifetime is caller-owned
relay.sync(events, {}, SyncDirection.BOTH, { timeout: 1_000 });
// @ts-expect-error concurrency must be numeric; runtime validates its positive finite integer value
relay.sync(events, {}, SyncDirection.BOTH, { concurrency: "4" });
