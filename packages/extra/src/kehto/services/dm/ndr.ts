import {
  getEventHash,
  mergeRelaySets,
  verifyEvent,
  type Filter,
  type NostrEvent,
  type VerifiedEvent,
} from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";
import type { NdrRuntimeOptions } from "nostr-double-ratchet";
import {
  concat,
  defer,
  distinct,
  filter,
  finalize,
  firstValueFrom,
  merge,
  mergeMap,
  of,
  ReplaySubject,
  Subscription,
  takeUntil,
  tap,
  throwError,
  timeout,
  timer,
  toArray,
} from "rxjs";
import type { KehtoPoolContext } from "../../foundation/pool.js";

/** Options for one account's NDR transport over the shared pool and store */
export interface KehtoNdrTransportOptions {
  /** The account identity authorized to sign unsigned owner events */
  ownerPubkey: string;
  /** The account-bound signer, without exposing its secret key */
  signer: ISigner;
  /** The explicit discovery and delivery relays, including ephemeral-device traffic */
  relays: string[];
  /** The maximum fetch duration in milliseconds (default 4000) */
  fetchTimeoutMs?: number;
  /** The signing and publication deadline in milliseconds (default 60000) */
  actionTimeoutMs?: number;
  /** The callback for subscription failures that NDR's callback contract cannot propagate */
  onSubscriptionError: (error: unknown) => void;
}

/** Runtime-compatible NDR hooks with explicit ownership of their subscriptions and pending work */
export interface KehtoNdrTransport extends Required<
  Pick<NdrRuntimeOptions, "nostrSubscribe" | "nostrFetch" | "nostrPublish" | "nostrSign">
> {
  /** Stops owned work without closing the shared pool or clearing protocol storage */
  dispose(): void;
}

/**
 * Creates NDR transport and owner-signing hooks without creating a protocol runtime or persistence
 * @throws if relays are empty or deadlines are not positive finite numbers
 */
export function createNdrTransport(context: KehtoPoolContext, options: KehtoNdrTransportOptions): KehtoNdrTransport {
  const relays = mergeRelaySets(options.relays);
  const fetchTimeoutMs = options.fetchTimeoutMs ?? context.timeout ?? 4000;
  const actionTimeoutMs = options.actionTimeoutMs ?? 60000;
  if (!relays.length) throw new Error("NDR requires explicit discovery and delivery relays");
  if (![fetchTimeoutMs, actionTimeoutMs].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("NDR deadlines must be positive finite numbers");
  }

  const { ownerPubkey, signer, onSubscriptionError } = options;
  const subscriptions = new Subscription();
  const disposed$ = new ReplaySubject<void>(1);
  const cancelled$ = disposed$.pipe(mergeMap(() => throwError(() => new Error("NDR transport disposed"))));

  function assertActive() {
    if (subscriptions.closed) throw new Error("NDR transport disposed");
  }

  function bounded<T>(work: (signal: AbortSignal) => Promise<T>) {
    assertActive();
    const controller = new AbortController();
    return firstValueFrom(
      defer(() => work(controller.signal)).pipe(
        timeout(actionTimeoutMs),
        takeUntil(cancelled$),
        finalize(() => controller.abort()),
      ),
    );
  }

  function isVerified(event: NostrEvent): event is VerifiedEvent {
    // Cached rumors and optimistic verification must not enter a cryptographic runtime.
    if (typeof event.sig !== "string") return false;
    const { id, pubkey, kind, tags, content, created_at, sig } = event;
    return verifyEvent({ id, pubkey, kind, tags, content, created_at, sig });
  }

  function storeEvent(event: VerifiedEvent) {
    context.eventStore.add(event);
  }

  const nostrSign: KehtoNdrTransport["nostrSign"] = (event) =>
    bounded(async (signal) => {
      // NDR's AppKeys builder leaves pubkey empty for an external owner signer to fill.
      if ((event.pubkey && event.pubkey !== ownerPubkey) || (await signer.getPublicKey()) !== ownerPubkey) {
        throw new Error("NDR owner signer mismatch");
      }

      assertActive();
      signal.throwIfAborted();
      const signed = await signer.signEvent({
        kind: event.kind,
        content: event.content,
        tags: event.tags,
        created_at: event.created_at,
      });

      assertActive();
      signal.throwIfAborted();
      if (
        !isVerified(signed) ||
        signed.pubkey !== ownerPubkey ||
        signed.id !== getEventHash({ ...event, pubkey: ownerPubkey })
      ) {
        throw new Error("NDR signer changed the owner event");
      }
      return signed;
    });

  return {
    nostrSign,
    nostrSubscribe: (eventFilter, onEvent) => {
      assertActive();
      const incoming$ = context.pool
        .subscription(relays, eventFilter, { reconnect: true })
        .pipe(filter(isVerified), tap(storeEvent));

      const subscription = merge(context.eventStore.filters([eventFilter]), incoming$)
        .pipe(
          filter(isVerified),
          distinct((event) => event.id),
          takeUntil(disposed$),
        )
        .subscribe({ next: onEvent, error: onSubscriptionError });
      subscriptions.add(subscription);
      return () => subscription.unsubscribe();
    },
    nostrFetch: (eventFilter: Filter) => {
      assertActive();
      const cached = [...context.eventStore.getByFilters([eventFilter])];
      const fetched$ = context.pool.request(relays, eventFilter).pipe(filter(isVerified), tap(storeEvent));

      return firstValueFrom(
        concat(of(...cached), fetched$).pipe(
          filter(isVerified),
          distinct((event) => event.id),
          // A total deadline bounds a busy relay as well as one that never sends EOSE.
          takeUntil(timer(fetchTimeoutMs)),
          toArray(),
          takeUntil(cancelled$),
        ),
      );
    },
    nostrPublish: (event) =>
      bounded(async (signal) => {
        // Session/device envelopes already have their own keys; never re-sign them as the owner.
        const signed = "sig" in event ? event : await nostrSign(event);
        if (!isVerified(signed)) throw new Error("Invalid signed NDR event");

        assertActive();
        signal.throwIfAborted();
        const results = await context.pool.publish(relays, signed);
        assertActive();
        signal.throwIfAborted();
        if (!results.some((result) => result.ok)) {
          throw new Error(results[0]?.message ?? "No relay accepted the NDR event");
        }

        storeEvent(signed);
        return signed;
      }),
    dispose: () => {
      if (subscriptions.closed) return;
      subscriptions.unsubscribe();
      disposed$.next();
      disposed$.complete();
    },
  };
}
