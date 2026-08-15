// Unit oracle for StreamSigners/createUserAuthHandler/connectedRelays$ (Task 1,
// plan 15-01). Every expected set below is written into the test as a literal,
// computed independently of what the implementation under test does — never
// derived from the holder's own state.

import { BehaviorSubject, EMPTY, Subject, firstValueFrom } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { nip44 } from "applesauce-core/helpers/encryption";
import { schnorr } from "@noble/curves/secp256k1.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { ISigner } from "applesauce-signers";
import type { Relay, RelayAuthContext, RelayPool, RelayStatus } from "applesauce-relay";
import type { GroupKey } from "../../helpers/crypto.js";
import { StreamSigners, connectedRelays$, createUserAuthHandler, lookupRelayStatus } from "../auth.js";

// ---- fixtures ---------------------------------------------------------------

/** A `GroupKey`-compatible fixture built from a fresh secp256k1 keypair, with
 *  every member `crypto.ts`'s `GroupKey` interface declares (sk/pk/convKey). */
function makeGroupKey(): GroupKey {
  const sk = generateSecretKey();
  const pk = getPublicKey(sk);
  const convKey = nip44.getConversationKey(sk, pk);
  return { sk, pk, convKey };
}

type AuthOutcome = "ok" | "reject" | "throw";

/** An inert relay stand-in (same structural shape `community.test.ts`'s
 *  `fakePool()` fixtures use) whose `authenticate` is a spy recording every
 *  `(pubkey, url)` pair it was called with, then resolving/rejecting per
 *  `outcome`. Returns the relay alongside the recorder array so a test can
 *  assert on call order/content directly. */
function authSpyRelay(url: string, outcome: AuthOutcome) {
  const recorder: { pubkey: string; url: string }[] = [];
  const relay = {
    url,
    challenge: "challenge",
    challenge$: new BehaviorSubject<string | null>("challenge"),
    isAuthenticated: () => false,
    authenticate: vi.fn(async (signer: { getPublicKey: () => Promise<string> }) => {
      const pubkey = await signer.getPublicKey();
      recorder.push({ pubkey, url });
      if (outcome === "throw") throw new Error("relay socket closed mid-auth");
      if (outcome === "reject") return { ok: false, from: url };
      return { ok: true, from: url };
    }),
    getSupported: async () => null,
    request: () => EMPTY,
    sync: () => EMPTY,
  };
  return { relay, recorder };
}

/** Synthesizes a full `RelayAuthContext` for a REQ-shaped operation. Never
 *  derives `missingPubkeys` from a holder's own state — that is the whole
 *  point of the oracle: the expected set comes from the operation's declared
 *  requirement, independent of the implementation under test. */
function ctx(relay: { url: string }, missingPubkeys: string[] | null): RelayAuthContext {
  return {
    relay: relay as unknown as Relay,
    url: relay.url,
    challenge: "challenge",
    request: { verb: "REQ", id: "sub", filters: [{}] },
    requirement: missingPubkeys ?? true,
    missingPubkeys,
    reason: "auth-required: restricted",
  };
}

// ---- StreamSigners: register / addSecretKey ---------------------------------

describe("StreamSigners.register", () => {
  it("is idempotent and pubkeys() reflects the held set", () => {
    const holder = new StreamSigners();
    const key = makeGroupKey();

    expect(holder.register([key])).toEqual([key.pk]);
    expect(holder.register([key])).toEqual([]);
    expect(holder.pubkeys()).toEqual([key.pk]);
  });
});

describe("StreamSigners.addSecretKey", () => {
  it("derives the x-only pubkey, is idempotent, and the pubkey answers a handler invocation", async () => {
    const holder = new StreamSigners();
    const sk = generateSecretKey();
    const expectedPubkey = bytesToHex(schnorr.getPublicKey(sk));

    const first = holder.addSecretKey(sk);
    const second = holder.addSecretKey(sk);
    expect(first).toBe(expectedPubkey);
    expect(second).toBe(expectedPubkey);
    expect(holder.pubkeys()).toEqual([expectedPubkey]);

    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");
    await holder.onAuthRequired(ctx(relay, [expectedPubkey]));
    expect(recorder).toEqual([{ pubkey: expectedPubkey, url: "wss://relay.example" }]);
  });
});

// ---- StreamSigners.onAuthRequired: scoping (CAUTH-01/T-15-01) ---------------

describe("StreamSigners.onAuthRequired scoping", () => {
  it("authenticates exactly the intersection of missingPubkeys and the held registry", async () => {
    const holder = new StreamSigners();
    const a = makeGroupKey();
    const b = makeGroupKey();
    const unheld = makeGroupKey();
    holder.register([a, b]);

    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");
    await holder.onAuthRequired(ctx(relay, [a.pk, b.pk, unheld.pk]));

    const authenticated = recorder.map((r) => r.pubkey).sort();
    expect(authenticated).toEqual([a.pk, b.pk].sort());
  });

  it("authenticates nothing for a missingPubkeys set containing only unheld pubkeys, without throwing or rejecting", async () => {
    const holder = new StreamSigners();
    const unheld = makeGroupKey();
    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");

    await expect(holder.onAuthRequired(ctx(relay, [unheld.pk]))).resolves.toBeUndefined();
    expect(recorder).toEqual([]);
  });

  it("authenticates nothing when missingPubkeys is null (never falls back to the registry)", async () => {
    const holder = new StreamSigners();
    const held = makeGroupKey();
    holder.register([held]);
    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");

    await holder.onAuthRequired(ctx(relay, null));
    expect(recorder).toEqual([]);
  });

  it("two disjoint holders sharing one relay only ever authenticate their own key (CAUTH-02/T-15-01)", async () => {
    const holderA = new StreamSigners();
    const holderB = new StreamSigners();
    const keyA = makeGroupKey();
    const keyB = makeGroupKey();
    holderA.register([keyA]);
    holderB.register([keyB]);

    // Anti-vacuity: a fixture bug that registered nothing (or the same key twice)
    // could otherwise make the isolation claim below pass silently.
    expect(holderA.pubkeys()).not.toEqual([]);
    expect(holderB.pubkeys()).not.toEqual([]);
    expect(holderA.pubkeys().some((pk) => holderB.pubkeys().includes(pk))).toBe(false);

    const { relay, recorder } = authSpyRelay("wss://relay.shared", "ok");
    await holderA.onAuthRequired(ctx(relay, [keyA.pk, keyB.pk]));
    await holderB.onAuthRequired(ctx(relay, [keyA.pk, keyB.pk]));

    const byPubkey = recorder.map((r) => r.pubkey);
    expect(byPubkey).toEqual([keyA.pk, keyB.pk]);

    // A null-requirement invocation against either holder must add nothing --
    // proving the never-fall-back-to-the-registry rule holds even in a
    // two-scope fixture, not only for a single isolated holder.
    await holderA.onAuthRequired(ctx(relay, null));
    await holderB.onAuthRequired(ctx(relay, null));
    expect(recorder.map((r) => r.pubkey)).toEqual([keyA.pk, keyB.pk]);
  });

  it("invoking the same handler twice with the same missingPubkeys sends two AUTHs (D-18, no dedupe)", async () => {
    const holder = new StreamSigners();
    const key = makeGroupKey();
    holder.register([key]);
    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");

    await holder.onAuthRequired(ctx(relay, [key.pk]));
    await holder.onAuthRequired(ctx(relay, [key.pk]));

    expect(recorder.filter((r) => r.pubkey === key.pk)).toHaveLength(2);
  });
});

// ---- StreamSigners.onAuthRequired: failure reporting (D-13) -----------------

describe("StreamSigners.onAuthRequired failure reporting", () => {
  it("reports exactly one onAuthFailure message on a relay rejection, and still resolves", async () => {
    const onAuthFailure = vi.fn();
    const holder = new StreamSigners({ onAuthFailure });
    const key = makeGroupKey();
    holder.register([key]);
    const { relay } = authSpyRelay("wss://relay.example", "reject");

    await expect(holder.onAuthRequired(ctx(relay, [key.pk]))).resolves.toBeUndefined();

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    const [message] = onAuthFailure.mock.calls[0];
    expect(message).toContain("wss://relay.example");
    expect(message).toContain(key.pk.slice(0, 8));
  });

  it("reports exactly one onAuthFailure message when authenticate throws, and still resolves", async () => {
    const onAuthFailure = vi.fn();
    const holder = new StreamSigners({ onAuthFailure });
    const key = makeGroupKey();
    holder.register([key]);
    const { relay } = authSpyRelay("wss://relay.example", "throw");

    await expect(holder.onAuthRequired(ctx(relay, [key.pk]))).resolves.toBeUndefined();

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    const [message] = onAuthFailure.mock.calls[0];
    expect(message).toContain("relay socket closed mid-auth");
  });
});

// ---- createUserAuthHandler (D-08/D-09/T-15-03) -------------------------------

describe("createUserAuthHandler", () => {
  const signer: ISigner = {
    getPublicKey: async () => "unused",
    signEvent: async (template) => ({ ...template, id: "unused", pubkey: "unused", sig: "unused" }),
  };

  it("authenticates when missingPubkeys is null", async () => {
    const userPubkey = getPublicKey(generateSecretKey());
    const handler = createUserAuthHandler(signer, () => userPubkey);
    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");

    await handler(ctx(relay, null));
    expect(recorder).toHaveLength(1);
  });

  it("authenticates when missingPubkeys contains the user's pubkey", async () => {
    const userPubkey = getPublicKey(generateSecretKey());
    const other = getPublicKey(generateSecretKey());
    const handler = createUserAuthHandler(signer, () => userPubkey);
    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");

    await handler(ctx(relay, [other, userPubkey]));
    expect(recorder).toHaveLength(1);
  });

  it("authenticates nothing when missingPubkeys is non-empty and excludes the user's pubkey", async () => {
    const userPubkey = getPublicKey(generateSecretKey());
    const other = getPublicKey(generateSecretKey());
    const handler = createUserAuthHandler(signer, () => userPubkey);
    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");

    await handler(ctx(relay, [other]));
    expect(recorder).toEqual([]);
  });

  it("no-ops when the pubkey thunk returns undefined", async () => {
    const handler = createUserAuthHandler(signer, () => undefined);
    const { relay, recorder } = authSpyRelay("wss://relay.example", "ok");

    await handler(ctx(relay, null));
    expect(recorder).toEqual([]);
  });
});

// ---- lookupRelayStatus / connectedRelays$ (D-12) -----------------------------

function mkStatus(over: Partial<RelayStatus> & { url: string }): RelayStatus {
  return {
    connected: false,
    authenticated: false,
    authenticatedAs: null,
    authenticatedPubkeys: [],
    authentications: {},
    ready: true,
    authRequiredForRead: false,
    authRequiredForPublish: false,
    challenge: null,
    ...over,
  };
}

describe("connectedRelays$", () => {
  it("emits false for an empty status snapshot", async () => {
    const status$ = new Subject<Record<string, RelayStatus>>();
    const pool = { status$ } as unknown as RelayPool;

    const value = await firstValueFrom(connectedRelays$(pool, ["wss://relay.example"]));
    expect(value).toBe(false);
  });

  it("emits true once any listed relay reports connected", async () => {
    const status$ = new BehaviorSubject<Record<string, RelayStatus>>({});
    const pool = { status$ } as unknown as RelayPool;
    const values: boolean[] = [];
    connectedRelays$(pool, ["wss://relay.example"]).subscribe((v) => values.push(v));

    status$.next({ "wss://relay.example/": mkStatus({ url: "wss://relay.example/", connected: true }) });
    expect(values).toEqual([false, true]);
  });

  it("tolerates a lookup whose key differs only by URL normalization", () => {
    // connectedRelays$'s own startWith({}) always precedes the pool's real
    // snapshot, so this asserts on the settled (second) emission rather than
    // firstValueFrom, which would resolve on the synthetic startWith value.
    const status$ = new BehaviorSubject<Record<string, RelayStatus>>({
      "wss://relay.example/": mkStatus({ url: "wss://relay.example/", connected: true }),
    });
    const pool = { status$ } as unknown as RelayPool;
    const values: boolean[] = [];

    // Subscribe with the un-normalized (no trailing slash) form.
    connectedRelays$(pool, ["wss://relay.example"]).subscribe((v) => values.push(v));

    expect(values).toEqual([false, true]);
    expect(
      lookupRelayStatus({ "wss://relay.example/": mkStatus({ url: "wss://relay.example/" }) }, "wss://relay.example"),
    ).toBeDefined();
  });

  it("does not re-emit for a repeated identical value", () => {
    const status$ = new BehaviorSubject<Record<string, RelayStatus>>({});
    const pool = { status$ } as unknown as RelayPool;
    const values: boolean[] = [];
    connectedRelays$(pool, ["wss://relay.example"]).subscribe((v) => values.push(v));

    status$.next({}); // still nothing connected -- same false value
    status$.next({ "wss://other/": mkStatus({ url: "wss://other/", connected: true }) }); // not in `relays`
    expect(values).toEqual([false]);
  });
});
