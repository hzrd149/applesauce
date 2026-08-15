import { describe, expect, it } from "vitest";
import { BehaviorSubject, EMPTY, firstValueFrom } from "rxjs";
import { RelayPool } from "applesauce-relay";
import { generateSecretKey, getPublicKey } from "applesauce-core/helpers/keys";
import { PrivateKeySigner } from "applesauce-signers";

import { createCommunity } from "../../helpers/community.js";
import { buildInviteBundle } from "../../helpers/invite-bundle.js";
import { DirectInviteFactory } from "../../factories/direct-invite.js";
import type { InviteBundle } from "../../types.js";
import { InviteWatcher } from "../invite-watcher.js";

async function makeInvite(bundle?: InviteBundle, recipient = new PrivateKeySigner(generateSecretKey())) {
  const inviterSk = generateSecretKey();
  const inviter = new PrivateKeySigner(inviterSk);
  const inviterPub = getPublicKey(inviterSk);
  const recipientPub = await recipient.getPublicKey();
  const material =
    bundle ??
    buildInviteBundle((await createCommunity({ ownerPubkey: inviterPub, name: "T", relays: ["wss://r"] })).material, {
      creator_npub: inviterPub,
    });
  const wrap = await DirectInviteFactory.create(material, recipientPub, inviter);
  return { wrap, bundle: material, recipient, recipientPub, inviterPub };
}

function watcher(signer: PrivateKeySigner, opts?: Partial<ConstructorParameters<typeof InviteWatcher>[0]>) {
  return new InviteWatcher({ signer, pool: new RelayPool(), relays: ["wss://relay.example"], ...opts });
}

describe("InviteWatcher", () => {
  it("tracks indexed wraps as pending until decrypted", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);

    await w.ingest(wrap);

    expect(w.wraps$.value).toEqual([wrap]);
    expect(w.pending$.value).toEqual([wrap]);
    expect(w.invites$.value).toEqual([]);
  });

  it("decrypts a pending wrap into a ConcordDirectInvite cast", async () => {
    const { wrap, recipient, inviterPub, bundle } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);

    const invite = await w.decrypt(wrap);

    expect(invite?.inviter).toBe(inviterPub);
    expect(invite?.communityId).toBe(bundle.community_id);
    expect(w.pending$.value).toEqual([]);
    expect(w.invites$.value).toEqual([invite]);
    expect(w.allInvites$.value).toEqual([invite]);
  });

  it("auto-decrypts when configured", async () => {
    const { wrap, recipient, bundle } = await makeInvite();
    const w = watcher(recipient, { autoDecrypt: true });

    await w.ingest(wrap);

    expect(w.pending$.value).toEqual([]);
    expect(w.invites$.value[0]?.communityId).toBe(bundle.community_id);
  });

  it("hides dismissed locked invites from pending", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);

    await w.dismiss(wrap);

    expect(w.isDismissed(wrap)).toBe(true);
    expect(w.pending$.value).toEqual([]);
    expect(w.wraps$.value).toEqual([wrap]);
  });

  it("hides dismissed decrypted invites but keeps them in allInvites", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);
    const invite = await w.decrypt(wrap);

    await w.dismiss(wrap);

    expect(w.invites$.value).toEqual([]);
    expect(w.allInvites$.value).toEqual([invite]);
  });

  it("restores a dismissed invite", async () => {
    const { wrap, recipient } = await makeInvite();
    const w = watcher(recipient);
    await w.ingest(wrap);
    const invite = await w.decrypt(wrap);
    await w.dismiss(wrap);

    await w.restore(wrap);

    expect(w.isDismissed(wrap)).toBe(false);
    expect(w.invites$.value).toEqual([invite]);
  });

  it("dismissal is per wrap, not per community", async () => {
    const first = await makeInvite();
    const second = await makeInvite(first.bundle, first.recipient);
    const w = watcher(first.recipient, { autoDecrypt: true });
    await w.ingest(first.wrap);

    await w.dismiss(first.wrap);
    await w.ingest(second.wrap);

    expect(w.invites$.value).toHaveLength(1);
    expect(w.invites$.value[0]?.communityId).toBe(first.bundle.community_id);
    expect(w.wraps$.value).toHaveLength(2);
  });

  it("readPending unlocks every pending invite and pendingCount$ tracks the backlog", async () => {
    const first = await makeInvite();
    const second = await makeInvite(undefined, first.recipient); // a second community, same recipient
    const w = watcher(first.recipient); // no autoDecrypt → invites stay locked/pending
    await w.ingest(first.wrap);
    await w.ingest(second.wrap);

    expect(w.pending$.value).toHaveLength(2);
    expect(await firstValueFrom(w.pendingCount$)).toBe(2);
    expect(w.invites$.value).toEqual([]);

    const unlocked = await w.readPending();

    expect(unlocked).toHaveLength(2);
    expect(w.pending$.value).toEqual([]); // nothing left to unlock
    expect(await firstValueFrom(w.pendingCount$)).toBe(0);
    expect(w.invites$.value).toHaveLength(2);
  });

  // Plan 15-06: replaces the old proactive-auth-option test, which asserted on
  // the two removed relay-wide-flag readers. Proves D-01 instead: the watcher
  // authenticates the user only when an inbox relay refuses one of its own
  // reads, never ambiently on connect or on a status emission.
  describe("reactive user auth (D-01/D-09) — the watcher authenticates only when an inbox relay refuses one of its own reads", () => {
    const AUTH_RELAY = "wss://iw-auth-relay.test";

    /** Records the historical `pool.request` and live `pool.subscription` calls'
     *  `{ filters, options }`, and every `relay.authenticate` call — mirrors
     *  community.test.ts's publish-answerability oracle pool (15-05 Task 3). */
    function authAnswerPool(): {
      pool: RelayPool;
      authenticateCalls: { pubkey: string; url: string }[];
      calls: {
        request?: { filters: unknown; options: Record<string, unknown> };
        subscription?: { filters: unknown; options: Record<string, unknown> };
      };
    } {
      const authenticateCalls: { pubkey: string; url: string }[] = [];
      const calls: {
        request?: { filters: unknown; options: Record<string, unknown> };
        subscription?: { filters: unknown; options: Record<string, unknown> };
      } = {};
      const relay = {
        url: AUTH_RELAY,
        isAuthenticated: () => false,
        authenticate: async (s: { getPublicKey: () => Promise<string> }) => {
          const pubkey = await s.getPublicKey();
          authenticateCalls.push({ pubkey, url: AUTH_RELAY });
          return { ok: true, from: AUTH_RELAY };
        },
        getSupported: async () => null,
      };
      const pool = {
        relay: () => relay,
        request: (_relays: string[], filters: unknown, options: Record<string, unknown> = {}) => {
          calls.request = { filters, options };
          return EMPTY;
        },
        subscription: (_relays: string[], filters: unknown, options: Record<string, unknown> = {}) => {
          calls.subscription = { filters, options };
          return { subscribe: () => ({ unsubscribe: () => {} }) };
        },
      } as unknown as RelayPool;
      return { pool, authenticateCalls, calls };
    }

    /** Synthesizes a `RelayAuthContext`-shaped value the same way community.test.ts's
     *  publish-answerability oracle does — the ONLY input this suite feeds a captured handler. */
    function authRequiredCtx(pool: RelayPool, missingPubkeys: string[] | null) {
      return {
        relay: pool.relay(AUTH_RELAY),
        url: AUTH_RELAY,
        challenge: null,
        request: { verb: "REQ" as const, id: "sub-1", filters: [] },
        requirement: missingPubkeys ?? true,
        missingPubkeys,
        reason: "auth-required",
      };
    }

    it("authenticates the user only when an inbox relay refuses one of its own reads", async () => {
      const signer = new PrivateKeySigner(generateSecretKey());
      const pubkey = await signer.getPublicKey();
      const { pool, authenticateCalls, calls } = authAnswerPool();

      const w = new InviteWatcher({ signer, pool, inboxRelays: [AUTH_RELAY] });

      await w.start();

      // D-01: zero ambient authentication before any relay refuses anything —
      // asserted BEFORE anything else, so this claim is checked first.
      expect(authenticateCalls).toEqual([]);

      // Both the historical request and the live subscription carry waitForAuth
      // for the user's own pubkey plus a callable onAuthRequired.
      expect(calls.request?.options.waitForAuth).toEqual([pubkey]);
      expect(typeof calls.request?.options.onAuthRequired).toBe("function");
      expect(calls.subscription?.options.waitForAuth).toEqual([pubkey]);
      expect(typeof calls.subscription?.options.onAuthRequired).toBe("function");

      // Invoking either captured handler with the user's own pubkey in
      // missingPubkeys records exactly one AUTH for that pubkey.
      const requestHandler = calls.request?.options.onAuthRequired as (ctx: unknown) => Promise<void>;
      await requestHandler(authRequiredCtx(pool, [pubkey]));
      expect(authenticateCalls).toEqual([{ pubkey, url: AUTH_RELAY }]);

      authenticateCalls.length = 0;
      const subscriptionHandler = calls.subscription?.options.onAuthRequired as (ctx: unknown) => Promise<void>;
      await subscriptionHandler(authRequiredCtx(pool, [pubkey]));
      expect(authenticateCalls).toEqual([{ pubkey, url: AUTH_RELAY }]);

      // An unrelated pubkey in missingPubkeys records nothing — the handler
      // owns exactly one identity (T-15-03).
      authenticateCalls.length = 0;
      const other = await new PrivateKeySigner(generateSecretKey()).getPublicKey();
      await requestHandler(authRequiredCtx(pool, [other]));
      expect(authenticateCalls).toEqual([]);

      w.stop();
    });
  });
});

// Plan 12.3-07: mirrors community.test.ts's extras describe block (Task 1) —
// reactivity, churn-guard, and the discovery-surface transport-free proof
// (D-08/D-09/D-14), plus the D-01 prohibition that extras never leak onto the
// public discovered-inbox subject.
describe("InviteWatcher extras (transport-only relay merge) — reactivity, churn, discovery-surface isolation (D-08/D-09/D-14)", () => {
  /** Records every `subscription` call's relay-TARGET argument. Local to this
   *  describe block only — the file's other tests are untouched. */
  function extrasWatcherPool(): { pool: RelayPool; subscriptionTargets: string[][] } {
    const subscriptionTargets: string[][] = [];
    const pool = {
      status$: new BehaviorSubject<Record<string, unknown>>({}),
      relay: () => ({
        isAuthenticated: () => true,
        authenticate: async () => ({ ok: true }),
      }),
      request: () => EMPTY,
      subscription: (relays: string[]) => {
        subscriptionTargets.push([...relays]);
        return { subscribe: () => ({ unsubscribe: () => {} }) };
      },
    } as unknown as RelayPool;
    return { pool, subscriptionTargets };
  }

  // Distinct, non-overlapping hostnames so no assertion can pass by coincidence.
  const INBOX_RELAYS = ["wss://iw-extras-inbox-a.test", "wss://iw-extras-inbox-b.test"];
  const EXTRA_ONE = "wss://iw-extras-extra-one.test";
  const EXTRA_TWO = "wss://iw-extras-extra-two.test";

  it("a second extras emission changes the live subscription's relay target while the discovered inboxes stay present (D-08/D-09)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, subscriptionTargets } = extrasWatcherPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const w = new InviteWatcher({ signer, pool, inboxRelays: INBOX_RELAYS, extraRelays: extras$ });
    await w.start();

    const before = subscriptionTargets.at(-1)!;
    expect(subscriptionTargets.length).toBeGreaterThan(0);
    expect(before.some((u) => u.includes("extras-extra-one"))).toBe(true);
    expect(before.some((u) => u.includes("extras-inbox-a"))).toBe(true);
    expect(before.some((u) => u.includes("extras-inbox-b"))).toBe(true);

    // Push a SECOND, DIFFERENT extras value (D-11) — a first-value-only
    // resolver would leave the target frozen on EXTRA_ONE forever.
    extras$.next([EXTRA_TWO]);

    const after = subscriptionTargets.at(-1)!;
    expect(after).not.toBe(before);
    expect(after.some((u) => u.includes("extras-extra-two"))).toBe(true);
    expect(after.some((u) => u.includes("extras-extra-one"))).toBe(false);
    expect(after.some((u) => u.includes("extras-inbox-a"))).toBe(true);
    expect(after.some((u) => u.includes("extras-inbox-b"))).toBe(true);

    w.stop();
  });

  it("an equal-content extras re-emission does not open a new live subscription (D-09 churn guard)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, subscriptionTargets } = extrasWatcherPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE, EXTRA_TWO]);

    const w = new InviteWatcher({ signer, pool, inboxRelays: INBOX_RELAYS, extraRelays: extras$ });
    await w.start();

    const callCountBefore = subscriptionTargets.length;
    expect(callCountBefore).toBeGreaterThan(0);

    // Same members, different array instance AND order — must not tear down
    // and reopen the live socket.
    extras$.next([EXTRA_TWO, EXTRA_ONE]);

    expect(subscriptionTargets.length).toBe(callCountBefore);

    w.stop();
  });

  it("relays$ (the public discovered-inbox surface) never reports the extras endpoint, even after extras are configured and pushed (D-01 prohibition)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool } = extrasWatcherPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const w = new InviteWatcher({ signer, pool, inboxRelays: INBOX_RELAYS, extraRelays: extras$ });
    await w.start();
    expect(w.relays$.value).toEqual(INBOX_RELAYS);

    extras$.next([EXTRA_TWO]);

    // Equality (not substring-absence) — this also catches an accidentally
    // DROPPED discovered inbox, which a substring-absence check would miss.
    expect(w.relays$.value).toEqual(INBOX_RELAYS);

    w.stop();
  });

  // Gap closure (WR-05/WR-06): stop() must be pause-only (restartable, extras
  // reactivity survives a restart) and dispose() must be the only thing that
  // actually releases the app-supplied extras source.
  it("stopped then started again is fully reactive to a later extras emission — not merged against a frozen snapshot (WR-06)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, subscriptionTargets } = extrasWatcherPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const w = new InviteWatcher({ signer, pool, inboxRelays: INBOX_RELAYS, extraRelays: extras$ });
    await w.start();
    expect(subscriptionTargets.at(-1)!.some((u) => u.includes("extras-extra-one"))).toBe(true);

    w.stop();
    await w.start();

    const countAfterRestart = subscriptionTargets.length;

    // A later emission AFTER the stop()/start() cycle — a frozen (disposed)
    // holder would never update `.current`, and the live subscription would
    // never reopen for it.
    extras$.next([EXTRA_TWO]);

    expect(subscriptionTargets.length).toBeGreaterThan(countAfterRestart);
    expect(subscriptionTargets.at(-1)!.some((u) => u.includes("extras-extra-two"))).toBe(true);
    expect(subscriptionTargets.at(-1)!.some((u) => u.includes("extras-extra-one"))).toBe(false);

    w.dispose();
  });

  it("disposed does not react to later extras emissions and holds no subscription to the source (WR-05)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool, subscriptionTargets } = extrasWatcherPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const w = new InviteWatcher({ signer, pool, inboxRelays: INBOX_RELAYS, extraRelays: extras$ });
    await w.start();
    expect(extras$.observed).toBe(true);

    w.dispose();

    expect(extras$.observed).toBe(false);

    const countAfterDispose = subscriptionTargets.length;
    extras$.next([EXTRA_TWO]);
    expect(subscriptionTargets.length).toBe(countAfterDispose); // no reopen after dispose
  });

  it("stop() alone leaves the extras subscription intact (pause-only, not a release)", async () => {
    const signer = new PrivateKeySigner(generateSecretKey());
    const { pool } = extrasWatcherPool();
    const extras$ = new BehaviorSubject<string[]>([EXTRA_ONE]);

    const w = new InviteWatcher({ signer, pool, inboxRelays: INBOX_RELAYS, extraRelays: extras$ });
    await w.start();
    expect(extras$.observed).toBe(true);

    w.stop();

    // stop() must NOT dispose the holder — only dispose() does.
    expect(extras$.observed).toBe(true);

    w.dispose();
    expect(extras$.observed).toBe(false);
  });
});
