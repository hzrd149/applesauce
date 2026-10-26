import { EventStore } from "applesauce-core";
import { finalizeEvent, kinds, unixNow } from "applesauce-core/helpers";
import { getPublicKey } from "applesauce-core/helpers/keys";
import type { RelayPool } from "applesauce-relay";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, firstValueFrom, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KehtoContext } from "../../types.js";
import { kehtoAccount$ } from "../account.js";
import { createApprovingSigner, createKehtoSigner, signForNapplet } from "../signer.js";

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
const create = (ctx: Partial<KehtoContext> = {}): KehtoContext => ({
  pool: pool as unknown as RelayPool,
  eventStore: store,
  ...ctx,
});
const relayList = (key: Uint8Array, tags: string[][]) =>
  finalizeEvent({ kind: kinds.RelayList, created_at: unixNow(), content: "", tags }, key);

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
});
describe("signForNapplet", () => {
  it("restamps created_at after approval", async () => {
    const state = create({ signer: alice, approve: () => true });
    const event = await signForNapplet(
      alice,
      { kind: 1, content: "hi", tags: [], created_at: 1 },
      { approve: state.approve },
    );
    expect(event.created_at).toBeGreaterThan(1);
    expect(event.pubkey).toBe(pk(alice));
  });

  it("throws when the host denies the request", async () => {
    const approve = vi.fn(() => false);
    await expect(
      signForNapplet(alice, { kind: 1, content: "", tags: [], created_at: 1 }, { approve, windowId: "win" }),
    ).rejects.toThrow("User denied");
    expect(approve).toHaveBeenCalledWith({
      windowId: "win",
      template: { kind: 1, content: "", tags: [], created_at: 1 },
    });
  });

  it("returns null without a signer", () => {
    expect(createKehtoSigner(undefined, { eventStore: store })).toBeNull();
  });
});

describe("signer account consistency", () => {
  it("keeps the captured account when the host switches accounts during approval", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(alice);
    const approve = vi.fn(() => {
      signer$.next(bob);
      return true;
    });
    const state = create({ signer: signer$, approve });
    const account = await firstValueFrom(kehtoAccount$(state));
    const signer = createApprovingSigner(account?.signer, { approve })!;
    const event = await signer.signEvent({ kind: 1, content: "hello", tags: [], created_at: 1 });

    expect(signer$.value).toBe(bob);
    expect(await signer.getPublicKey()).toBe(pk(alice));
    expect(event.pubkey).toBe(pk(alice));
  });

  it("reads relay permissions for the captured signer before shared pubkey resolution", async () => {
    store.add(relayList(alice.key, [["r", "wss://alice.relay.com/", "write"]]));
    const signer = createKehtoSigner(alice, { eventStore: store })!;

    expect(await signer.getRelays!()).toEqual({
      "wss://alice.relay.com/": { read: false, write: true },
    });
  });
});
