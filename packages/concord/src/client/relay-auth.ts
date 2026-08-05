// Stream-key NIP-42 authentication for Concord planes.
//
// Every Concord plane is kind-1059 traffic addressed to a DERIVED per-stream
// pubkey (control, guestbook, per-channel, dissolved, rekey) — never the user's
// identity. Relays that gate kind 1059 behind NIP-42 (e.g. ditto's default
// `AUTH_KINDS=4,1059`) require that EVERY `authors` entry in a 1059 REQ be an
// authenticated pubkey on the connection; the user's login can't satisfy that
// because the stream address isn't their pubkey.
//
// The client holds the stream SECRET keys (derived from community_root /
// channel keys), so it can NIP-42-authenticate AS each stream. This class is an
// instance-scoped registry of `PrivateKeySigner`s for the stream keys the client
// currently holds, plus the drivers that hand each one to applesauce's native
// `relay.authenticate(signer)` on every challenge. Signing is local (raw secret
// keys) — it never touches the user's signer / bunker.
//
// NB: this is NOT part of the frozen Concord spec (CORD-01..06 say nothing about
// NIP-42) — it is a relay-access convention (shared with armada). It replaces the
// app's module-global `stream-auth.ts` registry + `relay-auth.ts` drivers with a
// single instance so multiple clients (or accounts) never share stream keys.

import { PrivateKeySigner } from "applesauce-signers";
import type { ISigner } from "applesauce-signers";
import { BehaviorSubject, Observable, Subscription, combineLatest, distinctUntilChanged, map, startWith } from "rxjs";
import { normalizeURL } from "applesauce-core/helpers";
import type { Relay, RelayPool, RelayStatus } from "applesauce-relay";
import type { GroupKey } from "../helpers/crypto.js";
import { logger } from "../logger.js";

/** Module-level NIP-42 auth tracer (light operational tracing, D-03). Derived once
 *  at module scope — never `.extend()`d again at an individual log call site. */
const log = logger.extend("auth");

// One shared auth driver per relay URL, reference-counted. Both the control and
// channel gift-wrap subscriptions target the same relays and the same
// (whole-registry) stream keys, so a driver per subscription would send
// duplicate AUTHs; instead they share a single driver that lives as long as any
// subscription holds a reference.
interface Driver {
  sub: Subscription;
  refs: number;
}

export class ConcordRelayAuth {
  /** pubkey (x-only hex) → the signer that NIP-42-authenticates it. */
  private readonly registry = new Map<string, PrivateKeySigner>();

  /** Bumps whenever new stream keys register, so an already-open per-relay driver
   *  re-authenticates the newly-held keys (a channel folds in after the control
   *  plane is already subscribed). */
  private readonly version$ = new BehaviorSubject(0);

  private readonly drivers = new Map<string, Driver>();

  constructor(private readonly pool: RelayPool) {}

  /** Register stream keys (idempotent). Returns the pubkeys newly added. */
  registerStreamKeys(keys: GroupKey[]): string[] {
    const added: string[] = [];
    for (const k of keys) {
      if (this.registry.has(k.pk)) continue;
      this.registry.set(k.pk, new PrivateKeySigner(k.sk));
      added.push(k.pk);
    }
    if (added.length > 0) this.version$.next(this.version$.value + 1);
    return added;
  }

  streamPubkeys(): string[] {
    return [...this.registry.keys()];
  }

  // ---- connection / auth status (for UI) ----------------------------------

  /** Look up a relay's status in a `pool.status$` snapshot, tolerating un/normalized URLs. */
  private lookupStatus(statuses: Record<string, RelayStatus>, url: string): RelayStatus | undefined {
    return statuses[normalizeURL(url)] ?? statuses[url];
  }

  /**
   * Whether at least one of `relays` has an open socket, as a derived boolean
   * observable over `pool.status$`. For a community/channel to show a live vs
   * "reconnecting…" indicator without reaching into the pool itself.
   */
  connected$(relays: string[]): Observable<boolean> {
    return this.pool.status$.pipe(
      startWith({} as Record<string, RelayStatus>),
      map((statuses) => relays.some((url) => this.lookupStatus(statuses, url)?.connected ?? false)),
      distinctUntilChanged(),
    );
  }

  /**
   * Whether every currently-connected relay in `relays` is NIP-42-authenticated
   * for the caller's `streamPubkeys()` — i.e. either the relay gates nothing
   * behind auth, or all of our stream keys are authenticated on it. Re-evaluates
   * whenever `pool.status$` re-emits (connect / AUTH state changes). Returns false
   * when no relay is connected (nothing to be authenticated on yet).
   */
  authenticated$(relays: string[], streamPubkeys: () => string[]): Observable<boolean> {
    return this.pool.status$.pipe(
      startWith({} as Record<string, RelayStatus>),
      map((statuses) => {
        const connected = relays
          .map((url) => this.lookupStatus(statuses, url))
          .filter((s): s is RelayStatus => !!s?.connected);
        if (connected.length === 0) return false;
        const pubkeys = streamPubkeys();
        return connected.every((s) => {
          if (!s.authRequiredForRead && !s.authRequiredForPublish) return true;
          return pubkeys.every((pk) => s.authenticatedPubkeys.includes(pk));
        });
      }),
      distinctUntilChanged(),
    );
  }

  /** Every registered stream key as a `(pubkey, signer)` pair, for feeding to
   *  applesauce's native `relay.authenticate(signer)`. */
  streamSigners(): { pubkey: string; signer: PrivateKeySigner }[] {
    return [...this.registry.entries()].map(([pubkey, signer]) => ({ pubkey, signer }));
  }

  /**
   * Keep `relay` authenticated (NIP-42) as every registered stream key. Native
   * `relay.authenticate` handles the AUTH event and per-pubkey state; we re-run it
   * whenever the relay presents a fresh challenge (connect/reconnect) or new stream
   * keys register. A single-flight guard plus a make-progress loop keeps concurrent
   * triggers from racing while still picking up keys registered mid-run. Returns a
   * Subscription that releases this caller's reference; the shared driver stops at
   * zero refs.
   */
  authenticateStreamKeys(relay: Relay): Subscription {
    let driver = this.drivers.get(relay.url);
    if (!driver) {
      let running = false;
      const run = async (): Promise<void> => {
        if (running) return;
        running = true;
        try {
          // Loop so keys registered mid-run get authenticated too; stop when a
          // full pass makes no progress (a persistently-rejecting relay won't spin).
          for (;;) {
            const pending = this.streamSigners().filter(({ pubkey }) => !relay.isAuthenticated(pubkey));
            if (!relay.challenge || pending.length === 0) break;
            let progressed = false;
            for (const { pubkey, signer } of pending) {
              if (relay.isAuthenticated(pubkey)) continue;
              log("stream-key auth requested pk=%s relay=%s", pubkey.slice(0, 8), relay.url);
              try {
                const res = await relay.authenticate(signer);
                if (res.ok) {
                  progressed = true;
                  log("stream-key auth succeeded pk=%s relay=%s", pubkey.slice(0, 8), relay.url);
                } else {
                  log("stream-key auth rejected pk=%s relay=%s", pubkey.slice(0, 8), relay.url);
                }
              } catch (err) {
                log(
                  "stream-key AUTH to %s failed pk=%s: %s",
                  relay.url,
                  pubkey.slice(0, 8),
                  (err as Error)?.message ?? err,
                );
                console.warn(`stream-key AUTH to ${relay.url} failed`, err);
              }
            }
            if (!progressed) break;
          }
        } finally {
          running = false;
        }
      };
      // `challenge$` re-emits on every (re)connect; `version$` on new keys.
      const sub = combineLatest([relay.challenge$, this.version$]).subscribe(() => void run());
      driver = { sub, refs: 0 };
      this.drivers.set(relay.url, driver);
    }
    driver.refs++;

    return new Subscription(() => {
      const d = this.drivers.get(relay.url);
      if (!d) return;
      if (--d.refs <= 0) {
        d.sub.unsubscribe();
        this.drivers.delete(relay.url);
      }
    });
  }

  /**
   * Answer NIP-42 challenges with the USER's key so gating relays accept the
   * user's own published events (the Community List, invite bundles, …). Stream
   * reads authenticate per-relay via {@link authenticateStreamKeys}; this covers
   * only the user-authored write path across the pool's connected relays. Native
   * per-pubkey auth state (`isAuthenticated`) provides idempotency and resets on
   * reconnect, so we simply (re-)authenticate whenever a relay requires auth and
   * the user isn't yet authenticated on it.
   */
  autoAuthenticate(signer: ISigner, pubkey: string): Subscription {
    const inflight = new Set<string>();

    return this.pool.status$.subscribe((statuses) => {
      for (const [url, status] of Object.entries(statuses)) {
        if (!status.challenge) continue;
        if (!status.authRequiredForRead && !status.authRequiredForPublish) continue;
        const relay = this.pool.relay(url);
        if (relay.isAuthenticated(pubkey) || inflight.has(url)) continue;
        inflight.add(url);
        log("user auth requested pubkey=%s relay=%s", pubkey.slice(0, 8), url);
        relay
          .authenticate(signer)
          // Two-arg `.then` (not `.then().catch()`): `authenticate` RESOLVES with
          // `{ ok: false }` when the relay answers `OK false` ("restricted: …"),
          // so success must be read off the payload — same branch the stream-key
          // path above takes. The rejection handler is passed here rather than
          // chained so a throw from the success handler isn't misreported as an
          // AUTH failure.
          .then(
            (res) =>
              log(
                res?.ok ? "user auth succeeded pubkey=%s relay=%s" : "user auth rejected pubkey=%s relay=%s",
                pubkey.slice(0, 8),
                url,
              ),
            (err) => {
              log("user AUTH to %s failed pubkey=%s: %s", url, pubkey.slice(0, 8), (err as Error)?.message ?? err);
              console.warn(`user AUTH to ${url} failed`, err);
            },
          )
          .finally(() => inflight.delete(url));
      }
    });
  }
}
