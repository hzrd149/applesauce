import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import type { RelayPool } from "applesauce-relay";
import { BehaviorSubject, firstValueFrom, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredOutboxes, relaySelection$, selectReadRelays, selectRelayTier } from "../relays.js";

const alice = new PrivateKeySigner(new Uint8Array(32).fill(1));
const bob = new PrivateKeySigner(new Uint8Array(32).fill(2));
const pk = (signer: PrivateKeySigner) => getPublicKey(signer.key);

/** A fake pool whose req() messages are pushed by the test */
function fakePool() {
  const req$ = new Subject<any>();
  return {
    req$,
    req: vi.fn(() => req$),
    request: vi.fn(),
    publish: vi.fn(async (relays: string[]) => relays.map((from) => ({ from, ok: true }))),
    count: vi.fn(),
  };
}

let store: EventStore;
let pool: ReturnType<typeof fakePool>;
const relayList = (key: Uint8Array, tags: string[][]) =>
  finalizeEvent({ kind: kinds.RelayList, created_at: unixNow(), content: "", tags }, key);

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
});
describe("relay selection", () => {
  it("reads from the authors' stored outboxes and publishes to the user's outboxes", async () => {
    store.add(relayList(bob.key, [["r", "wss://bob.relay.com/", "write"]]));
    store.add(relayList(alice.key, [["r", "wss://alice.relay.com/"]]));

    expect(getStoredOutboxes(store, pk(bob))).toEqual(["wss://bob.relay.com/"]);
    expect(selectReadRelays(store, [{ authors: [pk(bob)] }], pk(alice))).toEqual(["wss://bob.relay.com/"]);
    expect(selectRelayTier(store, [], pk(alice), ["wss://fallback.relay.com/"])).toEqual(["wss://alice.relay.com/"]);
  });

  it("uses the fallback relays when nothing is known", () => {
    expect(selectRelayTier(store, [], pk(alice), ["wss://fallback.relay.com/"])).toEqual(["wss://fallback.relay.com/"]);
    expect(selectReadRelays(store, [{ kinds: [1] }], undefined, ["wss://fallback.relay.com/"])).toEqual([
      "wss://fallback.relay.com/",
    ]);
  });

  it("applies the selection limits and skips filtered relays", () => {
    store.add(
      relayList(bob.key, [
        ["r", "wss://one.relay.com/", "write"],
        ["r", "wss://two.relay.com/", "write"],
        ["r", "wss://three.relay.com/", "write"],
      ]),
    );
    const filters = [{ authors: [pk(bob)] }];

    expect(selectReadRelays(store, filters, undefined, [], { maxRelaysPerUser: 1 })).toHaveLength(1);
    const healthy = selectReadRelays(store, filters, undefined, [], {
      maxRelaysPerUser: 3,
      filterRelays: (relays) => relays.filter((relay) => relay !== "wss://one.relay.com/"),
    });
    expect(healthy).toEqual(expect.arrayContaining(["wss://two.relay.com/", "wss://three.relay.com/"]));
    expect(healthy).not.toContain("wss://one.relay.com/");
  });

  it("emits a new selection when the limits or the pool's relay health change", async () => {
    const unhealthy$ = new BehaviorSubject<string[]>([]);
    const maxConnections = new BehaviorSubject(12);
    const healthPool = {
      liveness: [{ unhealthy$, filter: (relays: string[]) => relays }],
      filterRelays: (relays: string[]) => relays.filter((relay) => !unhealthy$.value.includes(relay)),
    } as unknown as RelayPool;
    const emissions: number[] = [];
    const subscription = relaySelection$(healthPool, { maxConnections }).subscribe((selection) =>
      emissions.push(selection.maxConnections!),
    );

    maxConnections.next(5);
    unhealthy$.next(["wss://dead.relay.com/"]);
    const selection = await firstValueFrom(relaySelection$(healthPool, { maxConnections }));
    subscription.unsubscribe();

    expect(emissions).toEqual([12, 5, 5]);
    expect(selection.maxRelaysPerUser).toBe(3);
    expect(selection.filterRelays?.(["wss://dead.relay.com/", "wss://ok.relay.com/"])).toEqual(["wss://ok.relay.com/"]);
  });
});
