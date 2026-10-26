import { EventStore } from "applesauce-core";
import { getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { BehaviorSubject, Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKehtoAccount$, type KehtoAccount } from "../account.js";

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

beforeEach(() => {
  store = new EventStore({ verifyEvent: () => true });
  pool = fakePool();
});
describe("createKehtoAccount$", () => {
  it("clears the previous account synchronously and follows signer changes", async () => {
    const signer$ = new BehaviorSubject<PrivateKeySigner | undefined>(alice);
    const accounts: (KehtoAccount | undefined)[] = [];
    const sub = createKehtoAccount$(signer$).subscribe((account) => accounts.push(account));
    await vi.waitFor(() => expect(accounts.at(-1)?.pubkey).toBe(pk(alice)));

    signer$.next(bob);
    expect(accounts.at(-1)).toBeUndefined();
    await vi.waitFor(() => expect(accounts.at(-1)).toEqual({ signer: bob, pubkey: pk(bob) }));

    signer$.next(undefined);
    expect(accounts.at(-1)).toBeUndefined();
    sub.unsubscribe();
    expect(signer$.observed).toBe(false);
  });

  it("ignores delayed pubkeys from a previous signer and handles resolution failures", async () => {
    let resolve!: (pubkey: string) => void;
    const delayed = {
      ...alice,
      getPublicKey: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    };
    const signer$ = new BehaviorSubject<import("applesauce-signers").ISigner | undefined>(delayed);
    const accounts: (KehtoAccount | undefined)[] = [];
    const sub = createKehtoAccount$(signer$).subscribe((account) => accounts.push(account));
    signer$.next(bob);
    await vi.waitFor(() => expect(accounts.at(-1)?.pubkey).toBe(pk(bob)));
    resolve(pk(alice));
    await Promise.resolve();
    expect(accounts.at(-1)?.pubkey).toBe(pk(bob));

    signer$.next({
      ...delayed,
      getPublicKey: () => {
        throw new Error("unavailable");
      },
    });
    await vi.waitFor(() => expect(accounts.at(-1)).toBeUndefined());
    sub.unsubscribe();
  });
});
