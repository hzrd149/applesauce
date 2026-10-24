import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getStoredOutboxes, selectReadRelays, selectRelayTier } from "../relays.js";

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
});
