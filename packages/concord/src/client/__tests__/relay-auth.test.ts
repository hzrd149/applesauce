// Stream-key NIP-42 registry (CORD relay-access convention). Ported from
// selftest.ts §8, adapted to the instance-scoped ConcordRelayAuth. The live
// per-relay auth driver is exercised end-to-end by the puppeteer drivers
// (drive-auth.mjs) rather than here.

import { describe, expect, it } from "vitest";
import { BehaviorSubject } from "rxjs";
import { verifyEvent } from "applesauce-core/helpers/event";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { normalizeURL } from "applesauce-core/helpers";
import { PrivateKeySigner } from "applesauce-signers";
import { RelayPool, type RelayStatus } from "applesauce-relay";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity, deriveKeys } from "../../helpers/community.js";

/** A `pool.status$` stand-in — only `status$` is read by the connection helpers. */
function statusPool(status$: BehaviorSubject<Record<string, RelayStatus>>): RelayPool {
  return { status$ } as unknown as RelayPool;
}
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

describe("ConcordRelayAuth stream-key registry", () => {
  it("registers derived stream keys and signs kind-22242 AS each", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const genesis = await createCommunity({ ownerPubkey: await owner.getPublicKey(), name: "T", relays: ["wss://x"] });
    const keys = deriveKeys(genesis.material, []);

    const auth = new ConcordRelayAuth(new RelayPool());
    const added = auth.registerStreamKeys([keys.control, keys.guestbook]);
    expect(added.sort()).toEqual([keys.control.pk, keys.guestbook.pk].sort());
    // Idempotent: re-registering the same keys adds nothing.
    expect(auth.registerStreamKeys([keys.control, keys.guestbook])).toEqual([]);

    const signers = auth.streamSigners();
    expect(signers).toHaveLength(2);
    expect(auth.streamPubkeys()).toEqual(expect.arrayContaining([keys.control.pk, keys.guestbook.pk]));
    // Each signer authenticates AS its stream pubkey.
    expect(signers.some(({ pubkey }) => pubkey === keys.control.pk)).toBe(true);
    expect(signers.some(({ pubkey }) => pubkey === keys.guestbook.pk)).toBe(true);

    const auths = await Promise.all(
      signers.map(({ signer }) =>
        signer.signEvent({
          kind: 22242,
          content: "",
          created_at: Math.floor(Date.now() / 1000),
          tags: [
            ["relay", "wss://relay.example"],
            ["challenge", "challenge-abc"],
          ],
        }),
      ),
    );
    expect(auths.every((e) => e.kind === 22242 && verifyEvent(e))).toBe(true);
    expect(auths.every((e) => e.tags.find((t) => t[0] === "challenge")?.[1] === "challenge-abc")).toBe(true);
  });
});

describe("ConcordRelayAuth connection status", () => {
  const url = normalizeURL("wss://a");

  it("connected$ tracks whether any relay socket is open", () => {
    const status$ = new BehaviorSubject<Record<string, RelayStatus>>({});
    const auth = new ConcordRelayAuth(statusPool(status$));
    let connected = true;
    const sub = auth.connected$(["wss://a"]).subscribe((v) => (connected = v));

    expect(connected).toBe(false); // no status yet
    status$.next({ [url]: mkStatus({ url, connected: true }) });
    expect(connected).toBe(true);
    status$.next({ [url]: mkStatus({ url, connected: false }) });
    expect(connected).toBe(false);
    sub.unsubscribe();
  });

  it("authenticated$ requires our stream keys on every connected auth-gated relay", () => {
    const status$ = new BehaviorSubject<Record<string, RelayStatus>>({});
    const auth = new ConcordRelayAuth(statusPool(status$));
    let authed = true;
    const sub = auth.authenticated$(["wss://a"], () => ["pk1"]).subscribe((v) => (authed = v));

    expect(authed).toBe(false); // not connected → nothing to be authenticated on
    // Connected + auth-gated but our stream key isn't authenticated yet → false.
    status$.next({ [url]: mkStatus({ url, connected: true, authRequiredForRead: true, authenticatedPubkeys: [] }) });
    expect(authed).toBe(false);
    // Our stream key is now authenticated → true.
    status$.next({
      [url]: mkStatus({ url, connected: true, authRequiredForRead: true, authenticatedPubkeys: ["pk1"] }),
    });
    expect(authed).toBe(true);
    // A relay that gates nothing behind auth counts as authenticated regardless.
    status$.next({ [url]: mkStatus({ url, connected: true }) });
    expect(authed).toBe(true);
    sub.unsubscribe();
  });
});
