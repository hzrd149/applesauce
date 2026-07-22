// D-11/TEST-01 regression guard: proves `syncEpoch`'s aggregate fetched/decoded/
// dropped logging (D-05) fires even when zero wraps arrive, and that N
// deliberately undecryptable wraps (sealed under a WRONG convKey — never the one
// the sync loop derives, per VALIDATION.md's Wave-0 note) produce
// `fetched=N decoded=0 dropped=N` plus N per-wrap `:sync:decode` lines (D-06/D-07)
// — the exact litmus contrast CONTEXT.md's <specifics> describes: a zero-event
// sync must read differently from an arrived-but-undecryptable one. Mirrors
// sync.test.ts's dependency-injected `servingPool`/`SyncContext` fixture shape
// (no sockets, no ConcordCommunity); no production code is touched.
//
// `SyncContext.logger`/`decodeLogger` are separate pre-derived fields (the
// plan-02 course-correction) rather than `ctx.logger.extend("decode")` at the
// call site, so the fixture below supplies two independent spies instead of one
// spy exposing `.extend()` — matching the ACTUAL current interface rather than
// the phase plan's now-superseded literal text (documented as a deviation in
// the plan's SUMMARY.md).

import { format } from "node:util";
import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, NEVER, Subject, from } from "rxjs";
import type { Debugger } from "debug";
import { generateSecretKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";
import { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers/event";
import type { RelayPool } from "applesauce-relay";

import { ConcordRelayAuth } from "../relay-auth.js";
import { createCommunity } from "../../helpers/community.js";
import { deriveConcordKeys } from "../../helpers/keys.js";
import { toRumor, sealRumor, wrapSeal } from "../../operations/gift-wrap.js";
import { GIFT_WRAP_KIND } from "../../helpers/gift-wrap.js";
import { syncEpoch, type SyncContext } from "../sync.js";

/** A minimal RelayPool stand-in that serves `events` matching a REQ's authors/
 *  kinds and completes (EOSE) — no sockets, no live subscription. Identical
 *  shape to sync.test.ts's `servingPool` (minus filter capture, unneeded here). */
function servingPool(events: NostrEvent[]): RelayPool {
  const relay = {
    url: "wss://fake",
    challenge: null,
    challenge$: new BehaviorSubject<string | null>(null),
    isAuthenticated: () => false,
    authenticate: async () => ({ ok: true }),
    getSupported: async () => null,
    sync: () => EMPTY,
    request: (filters: unknown) => {
      const fs = (Array.isArray(filters) ? filters : [filters]) as { kinds?: number[]; authors?: string[] }[];
      const match = events.filter((e) =>
        fs.some((f) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.authors || f.authors.includes(e.pubkey))),
      );
      return from(match);
    },
  };
  return {
    status$: new Subject(),
    relay: () => relay,
    subscription: () => NEVER,
    request: (_relays: string[], filters: unknown) => relay.request(filters),
    publish: async () => [],
  } as unknown as RelayPool;
}

/** A callable spy standing in for an injected `Debugger` (D-02): records every
 *  call's raw arguments. Cast to `Debugger` since it satisfies only the
 *  call-signature this codebase's log sites use (`syncEpoch` never calls
 *  `.extend()`/`.enabled` on `ctx.logger`/`ctx.decodeLogger` — those are
 *  pre-derived once by each `syncContext()` builder, per the plan-02
 *  course-correction). */
function spyLogger(): { log: Debugger; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const log = ((...args: unknown[]) => {
    calls.push(args);
  }) as unknown as Debugger;
  return { log, calls };
}

/** Render a captured call the way `debug` would format it on output. This
 *  codebase's new log lines only use `%s`/`%d`, both of which `util.format`
 *  substitutes identically to `debug`'s own formatter, so assertions read the
 *  same message a developer with `DEBUG=applesauce:concord:*` would see. */
function render(call: unknown[]): string {
  return format(...(call as [unknown, ...unknown[]]));
}

describe("syncEpoch decode-boundary logging — D-05/D-06/D-07 litmus (D-11/TEST-01)", () => {
  it("a zero-wrap sync logs the aggregate fetched=0 line and never logs per-wrap decode detail", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const self = new PrivateKeySigner(generateSecretKey());
    const selfPub = await self.getPublicKey();

    const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material = genesis.material;

    const pool = servingPool([]); // the relay serves nothing — a genuine "no events" sync
    const aggregate = spyLogger();
    const decode = spyLogger();
    const ctx: SyncContext = {
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      signer: self,
      self: selfPub,
      relays: ["wss://fake"],
      route: () => {},
      ensureAuth: () => {},
      logger: aggregate.log,
      decodeLogger: decode.log,
    };

    await syncEpoch(ctx, material, undefined, false);

    // Non-vacuous (TEST-01): the expected count (0) is known independently —
    // the pool was constructed to serve zero events — not read back from the
    // implementation under test.
    const coreLine = aggregate.calls.map(render).find((m) => m.startsWith("core planes"));
    expect(coreLine).toBeDefined();
    expect(coreLine).toContain("fetched=0");
    expect(coreLine).toContain("decoded=0");
    expect(coreLine).toContain("dropped=0");
    // Zero wraps arrived, so the per-wrap decode-boundary detail never fires.
    expect(decode.calls.length).toBe(0);
  });

  it("N wraps sealed under the WRONG convKey log fetched=N decoded=0 dropped=N plus N per-wrap :sync:decode lines, leaking no secret/content", async () => {
    const owner = new PrivateKeySigner(generateSecretKey());
    const ownerPub = await owner.getPublicKey();
    const self = new PrivateKeySigner(generateSecretKey());
    const selfPub = await self.getPublicKey();

    const genesis = await createCommunity({ ownerPubkey: ownerPub, name: "T", relays: ["wss://fake"] });
    const material = genesis.material;
    const keys = deriveConcordKeys(material, []);

    // Deliberately undecryptable wraps (VALIDATION.md Wave-0 note): sealed and
    // wrapped correctly under the CONTROL plane's stream secret key (so they
    // land on the right author/kind filter and `keys.planes.get(pubkey)`
    // resolves to the control plane), but the outer wrap layer is encrypted
    // under a WRONG convKey — never `keys.control.convKey`, the one `syncEpoch`
    // actually derives and decrypts with — so decryption fails by construction,
    // not by accident. N is fixed here, independent of the implementation.
    const N = 3;
    const wrongConvKey = new Uint8Array(32).fill(0xab);
    const undecryptable: NostrEvent[] = [];
    for (let i = 0; i < N; i++) {
      const rumor = await toRumor(owner)({
        kind: 1,
        content: `secret message ${i}`,
        tags: [],
        created_at: Math.floor(Date.now() / 1000),
      });
      const seal = await sealRumor(keys.control.convKey, owner)(rumor);
      const wrap = await wrapSeal(keys.control.sk, wrongConvKey)(seal);
      undecryptable.push(wrap);
    }
    expect(undecryptable).toHaveLength(N);
    expect(undecryptable.every((w) => w.kind === GIFT_WRAP_KIND)).toBe(true);
    expect(undecryptable.every((w) => w.pubkey === keys.control.pk)).toBe(true);

    const pool = servingPool(undecryptable);
    const aggregate = spyLogger();
    const decode = spyLogger();
    const ctx: SyncContext = {
      pool,
      relayAuth: new ConcordRelayAuth(pool),
      eventStore: new EventStore(),
      signer: self,
      self: selfPub,
      relays: ["wss://fake"],
      route: () => {},
      ensureAuth: () => {},
      logger: aggregate.log,
      decodeLogger: decode.log,
    };

    await syncEpoch(ctx, material, undefined, false);

    const coreLine = aggregate.calls.map(render).find((m) => m.startsWith("core planes"));
    expect(coreLine).toBeDefined();
    expect(coreLine).toContain(`fetched=${N}`);
    expect(coreLine).toContain("decoded=0");
    expect(coreLine).toContain(`dropped=${N}`);

    // Per-wrap decode-boundary detail: exactly N lines, independently counted
    // (not read back from `coreDropped`).
    expect(decode.calls.length).toBe(N);
    for (const call of decode.calls) {
      const line = render(call);
      expect(line).toMatch(/^dropped wrap=[0-9a-f]{8} plane=control epoch=\d+$/);
      // No decoded rumor content, convKey, or seal bytes ever appear in a
      // captured line — the real author is inside the unopened seal and is
      // unavailable by construction (D-06), and only the wrap id/plane/epoch
      // are logged.
      for (const arg of call) expect(String(arg)).not.toContain("secret message");
    }
  });
});
