// Regression coverage for the "request hangs forever" bug: `genericCall` used to await
// `firstValueFrom(encryption$)` *before* installing the response timeout, so a wallet that
// never announces its capabilities (kind:13194) left the request pending indefinitely and the
// negotiation subscription leaked. These tests pin the deadline to the request up to its first
// response and prove the negotiation waiter is torn down.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TimeoutError } from "applesauce-core";
import { concat, EmptyError, NEVER, Observable, of, Subject } from "rxjs";

import { FakeUser } from "./fake-user.js";
import { WalletResponseFactory } from "../factories/response.js";
import { WalletConnectEncryptionMethod } from "../helpers/encryption.js";
import { getWalletRequestEncryption } from "../helpers/request.js";
import { WALLET_INFO_KIND } from "../helpers/support.js";
import { GetInfoMethod } from "../helpers/methods.js";
import { WalletConnect, WalletConnectOptions } from "../wallet-connect.js";

const CLIENT = new FakeUser();
const SERVICE = new FakeUser();

/** Build a wallet info (kind:13194) event signed by the wallet service */
function walletInfo(content = "get_info get_balance", tags: string[][] = []) {
  return SERVICE.event({ kind: WALLET_INFO_KIND, content, tags });
}

function createWallet(overrides: Partial<WalletConnectOptions> = {}) {
  return new WalletConnect({
    secret: CLIENT.key,
    relays: [],
    service: SERVICE.pubkey,
    timeout: 50,
    // Default to a subscription that never emits or completes, like a stale relay connection.
    subscriptionMethod: () => NEVER,
    publishMethod: async () => {},
    ...overrides,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("genericCall request deadline", () => {
  it("rejects within the deadline when the wallet never announces an encryption method", async () => {
    const wallet = createWallet();

    const pending = wallet.getInfo();
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });

  it("does not leave the encryption negotiation subscribed after the deadline fires", async () => {
    let subscribers = 0;
    const wallet = createWallet();
    wallet.encryption$ = new Observable<WalletConnectEncryptionMethod>(() => {
      subscribers += 1;
      return () => {
        subscribers -= 1;
      };
    });

    const pending = wallet.getInfo();
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await assertion;

    // A promise-based `firstValueFrom` would still hold this subscription open.
    expect(subscribers).toBe(0);
  });

  it("does not publish a request when wallet info arrives after the deadline", async () => {
    const events$ = new Subject<any>();
    const publish = vi.fn(async () => {});
    const wallet = createWallet({ subscriptionMethod: () => events$.asObservable(), publishMethod: publish });

    const pending = wallet.getInfo();
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await assertion;
    expect(publish).not.toHaveBeenCalled();

    // Late capability announcement must not resurrect the cancelled request.
    events$.next(walletInfo());
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).not.toHaveBeenCalled();
  });

  it("still times out waiting for a response after negotiation succeeds", async () => {
    const published: any[] = [];
    const wallet = createWallet({
      subscriptionMethod: () =>
        new Observable<any>((subscriber) => {
          subscriber.next(walletInfo("get_info get_balance", [["encryption", "nip44_v2"]]));
        }),
      publishMethod: async (_relays, event) => {
        published.push(event);
      },
    });

    const pending = wallet.getInfo();
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await assertion;

    // Negotiation succeeded (the request was published), so this is the response deadline firing.
    expect(published).toHaveLength(1);
  });

  it("honours a per-call timeout override over the constructor timeout", async () => {
    const wallet = createWallet({ timeout: 10_000 });

    const pending = wallet.request("get_info", {}, { timeout: 30 });
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(35);
    await assertion;
  });

  it("counts negotiation time against the deadline instead of restarting it", async () => {
    const events$ = new Subject<any>();
    const published: any[] = [];
    const wallet = createWallet({
      timeout: 100,
      subscriptionMethod: () => events$.asObservable(),
      publishMethod: async (_relays, event) => {
        published.push(event);
      },
    });

    const pending = wallet.getInfo();
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    // Capabilities arrive halfway through the deadline and the request is published...
    await vi.advanceTimersByTimeAsync(60);
    events$.next(walletInfo("get_info get_balance", [["encryption", "nip44_v2"]]));
    await vi.advanceTimersByTimeAsync(0);
    expect(published).toHaveLength(1);

    // ...but the original 100ms deadline still fires (it is not restarted by negotiation).
    await vi.advanceTimersByTimeAsync(40);
    await assertion;
  });

  it("resolves a request after successful negotiation", async () => {
    const responses$ = new Subject<any>();
    const wallet = createWallet({
      timeout: 500,
      subscriptionMethod: () =>
        concat(of(walletInfo("get_info get_balance", [["encryption", "nip44_v2"]])), responses$.asObservable()),
      publishMethod: async (_relays, event) => {
        const response = await WalletResponseFactory.create<GetInfoMethod>(event, {
          result_type: "get_info",
          error: null,
          result: { methods: ["get_info"], alias: "test-wallet" },
        })
          .as(SERVICE)
          .sign();
        responses$.next(response);
      },
    });

    await expect(wallet.getInfo()).resolves.toMatchObject({ alias: "test-wallet" });
  });

  it("uses nip04 when the wallet info event omits the encryption tag", async () => {
    const published: any[] = [];
    const wallet = createWallet({
      subscriptionMethod: () =>
        new Observable<any>((subscriber) => {
          subscriber.next(walletInfo("get_info", []));
        }),
      publishMethod: async (_relays, event) => {
        published.push(event);
      },
    });

    const pending = wallet.getInfo();
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(60);
    await assertion;

    expect(published).toHaveLength(1);
    expect(getWalletRequestEncryption(published[0])).toBe("nip04");
  });
});

describe("waitForService abort signal", () => {
  it("returns the known service immediately even when the signal is already aborted", async () => {
    const wallet = createWallet();
    const controller = new AbortController();
    controller.abort();

    await expect(wallet.waitForService(controller.signal)).resolves.toBe(SERVICE.pubkey);
  });

  it("rejects with the signal reason when the signal is already aborted", async () => {
    const wallet = createWallet({ service: undefined });
    const controller = new AbortController();
    const reason = new Error("aborted before waiting");
    controller.abort(reason);

    await expect(wallet.waitForService(controller.signal)).rejects.toBe(reason);
  });

  // Pre-existing semantics: aborting while waiting completes the stream via `takeUntil`, so
  // `firstValueFrom` rejects with `EmptyError` rather than the signal reason. Pinned here so a
  // future change to unify abort errors is a deliberate decision.
  it("rejects with EmptyError when the signal aborts while waiting", async () => {
    const wallet = createWallet({ service: undefined });
    const controller = new AbortController();

    const pending = wallet.waitForService(controller.signal);
    const assertion = expect(pending).rejects.toBeInstanceOf(EmptyError);
    controller.abort();

    await assertion;
  });
});
