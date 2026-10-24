import type { DmSendRequest } from "@kehto/services";
import type { ISigner } from "applesauce-signers";
import { castUser } from "applesauce-common/casts";
import { GiftWrapFactory } from "applesauce-common/factories";
import { getConversationParticipants, unlockGiftWrap } from "applesauce-common/helpers";
import { getEventHash, kinds, unixNow, type NostrEvent } from "applesauce-core/helpers";
import {
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  map,
  merge,
  of,
  ReplaySubject,
  shareReplay,
  startWith,
  switchMap,
  takeUntil,
  takeWhile,
  timeout,
} from "rxjs";
import { kehtoAccount$, type KehtoAccount } from "../../foundation/account.js";
import { subscribeThroughStore } from "../../foundation/pool.js";
import { configured$, settle } from "../../helpers.js";
import { DmExpirationTracker } from "./expiration.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import { DmPublicationError, publishAcceptedMessage, type DmPublicationResult } from "./publication.js";
import type {
  DmOperationContext,
  DmPreparedSend,
  DmProtocolAdapter,
  DmProtocolAvailability,
  DmProtocolMessage,
  DmProtocolSession,
  DmReadContext,
  DmRecipientSupport,
} from "./types.js";

interface WrappedPublication {
  recipient: string;
  event: NostrEvent;
  relays: string[];
  accepted: boolean;
  error?: unknown;
}

interface WrappedDelivery {
  fingerprint: string;
  message: DmProtocolMessage;
  publications: WrappedPublication[];
  publishing: boolean;
}

interface WrappedSendCache {
  deliveries: Map<string, WrappedDelivery>;
  preparing: Set<string>;
}

/** Creates a NIP-17 protocol with NIP-44 encryption and per-participant gift wraps */
export function createWrappedMessageProtocol(config: NostrMessageProtocolOptions): DmProtocolAdapter {
  const wait = config.timeout ?? 4000;
  const closed$ = new ReplaySubject<void>(1);
  const pendingDecryptions = new WeakMap<ISigner, Map<string, Promise<DmProtocolMessage | undefined>>>();
  let closed = false;
  let currentAccount: KehtoAccount | undefined;
  let currentSession: DmProtocolSession | undefined;

  function fallbackRelays() {
    return settle(configured$(config.fallbackRelays, []), [], wait);
  }

  async function recipientRelays(pubkey: string): Promise<DmRecipientSupport> {
    const user = castUser(pubkey, config.eventStore);
    const relays = await settle(user.directMessageRelays$, undefined, wait);
    return {
      recipient: pubkey,
      support: relays === undefined ? "unknown" : relays.length ? "supported" : "unsupported",
      relays,
    };
  }

  async function deliveryRelays(pubkey: string) {
    const user = castUser(pubkey, config.eventStore);
    const advertised = await settle(user.directMessageRelays$, undefined, wait);
    return advertised ?? [];
  }

  async function historyRelays(pubkey: string) {
    const advertised = await deliveryRelays(pubkey);
    return advertised.length ? advertised : fallbackRelays();
  }

  function relays$(pubkey: string) {
    const advertised$ = castUser(pubkey, config.eventStore).directMessageRelays$;
    return combineLatest([
      advertised$.pipe(startWith(undefined)),
      configured$(config.fallbackRelays, []).pipe(
        startWith([]),
        catchError(() => of([])),
      ),
    ]).pipe(
      map(([advertised, fallback]) => (advertised?.length ? advertised : fallback)),
      distinctUntilChanged(
        (previous, next) => previous.length === next.length && previous.every((relay, index) => relay === next[index]),
      ),
    );
  }

  function validateRecipients(request: DmSendRequest) {
    if (!request.recipients.length || request.recipients.some((recipient) => !/^[0-9a-f]{64}$/.test(recipient)))
      throw new Error("Invalid recipients");
  }

  async function discover(
    request: DmSendRequest,
    owner: KehtoAccount,
    context: DmOperationContext,
  ): Promise<DmProtocolAvailability> {
    context.signal.throwIfAborted();
    validateRecipients(request);
    const participants = [...new Set([...request.recipients, owner.pubkey])];
    const support = await Promise.all(participants.map(recipientRelays));
    context.signal.throwIfAborted();
    return {
      canSend: support.every((recipient) => !!recipient.relays?.length),
      support: support.every((recipient) => recipient.support === "supported")
        ? "supported"
        : support.some((recipient) => recipient.support === "unsupported")
          ? "unsupported"
          : "unknown",
      recipients: support,
      hasFallback: false,
    };
  }

  async function decrypt(
    event: NostrEvent,
    owner: KehtoAccount,
    expiration: DmExpirationTracker,
  ): Promise<DmProtocolMessage | undefined> {
    const rumor = await unlockGiftWrap(event, owner.signer);
    const participants = getConversationParticipants(rumor);
    if (rumor.kind !== kinds.PrivateDirectMessage || !participants.includes(owner.pubkey)) return;
    if (config.mirrorExpiration) expiration.observe(rumor, participants);
    return {
      id: rumor.id,
      participants,
      senderPubkey: rumor.pubkey,
      createdAt: rumor.created_at,
      content: rumor.content,
      status: rumor.pubkey === owner.pubkey ? "sent" : "received",
    };
  }

  function readMessage$(event: NostrEvent, owner: KehtoAccount, expiration: DmExpirationTracker) {
    return defer(() => {
      let pending = pendingDecryptions.get(owner.signer);
      if (!pending) {
        pending = new Map();
        pendingDecryptions.set(owner.signer, pending);
      }
      let decryption = pending.get(event.id);
      if (!decryption) {
        decryption = decrypt(event, owner, expiration);
        pending.set(event.id, decryption);
        // Unresolved signer promises stay shared when an individual reader times out.
        const release = () => pending.delete(event.id);
        void decryption.then(release, release);
      }
      return decryption;
    }).pipe(
      timeout({ first: config.decryptionTimeout ?? 60000 }),
      catchError(() => EMPTY),
      filter((message): message is DmProtocolMessage => !!message),
    );
  }

  function messages$(owner: KehtoAccount, context: DmReadContext, expiration: DmExpirationTracker) {
    return defer(() => {
      context.signal.throwIfAborted();
      let active = true;
      const seen = new Set<string>();
      const mailboxFilter = { kinds: [kinds.GiftWrap], "#p": [owner.pubkey] };
      const targets$ = context.history ? defer(() => historyRelays(owner.pubkey)) : relays$(owner.pubkey);

      return targets$.pipe(
        switchMap((relays) => {
          const source$ = subscribeThroughStore(config, relays, [mailboxFilter]);
          return context.history ? source$.pipe(takeWhile((event) => event !== "EOSE", true)) : source$;
        }),
        filter((event): event is NostrEvent => event !== "EOSE"),
        filter((event) => {
          if (seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        }),
        concatMap((event) =>
          defer(() => {
            context.signal.throwIfAborted();
            if (!active) return EMPTY;
            return readMessage$(event, owner, expiration);
          }),
        ),
        finalize(() => {
          active = false;
        }),
      );
    });
  }

  function publishDelivery$(delivery: WrappedDelivery, context: DmOperationContext) {
    return defer(async () => {
      context.signal.throwIfAborted();
      if (closed) throw new Error("DM protocol closed");
      if (delivery.publishing) throw new Error("DM message is already being published");
      delivery.publishing = true;

      try {
        for (const publication of delivery.publications) {
          context.signal.throwIfAborted();
          if (closed) throw new Error("DM protocol closed");
          if (publication.accepted) continue;

          try {
            await publishAcceptedMessage(config, publication.relays, publication.event);
            publication.accepted = true;
            publication.error = undefined;
          } catch (error) {
            publication.error = error;
          }
        }
        context.signal.throwIfAborted();

        const results: DmPublicationResult[] = delivery.publications.map((publication) => ({
          recipient: publication.recipient,
          eventId: publication.event.id,
          accepted: publication.accepted,
          error: publication.error,
        }));
        if (results.some((result) => !result.accepted)) throw new DmPublicationError(delivery.message, results);
        return delivery.message;
      } finally {
        delivery.publishing = false;
      }
    });
  }

  function prepareSend$(
    request: DmSendRequest,
    owner: KehtoAccount,
    context: DmOperationContext,
    cache: WrappedSendCache,
    expiration: DmExpirationTracker,
  ) {
    return defer(() => {
      let active = true;
      const cacheKey = request.clientMessageId
        ? JSON.stringify([context.windowId, request.clientMessageId])
        : undefined;
      const fingerprint = JSON.stringify([
        [...new Set(request.recipients)].sort(),
        request.content,
        request.conversationId,
      ]);
      let ownsPreparation = false;
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        if (!active || closed) throw new Error("DM protocol operation ended");
      };
      return defer(async (): Promise<DmPreparedSend> => {
        validateRecipients(request);
        assertCurrent();
        if (cacheKey) {
          const previous = cache.deliveries.get(cacheKey);
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw new Error("DM clientMessageId belongs to another message");
            return { message: previous.message, publish$: publishDelivery$(previous, context) };
          }
          if (cache.preparing.has(cacheKey)) throw new Error("DM message is already being prepared");
          cache.preparing.add(cacheKey);
          ownsPreparation = true;
        }

        const participants = [...new Set([...request.recipients, owner.pubkey])];
        // In NIP-17 every p tag is a recipient, so note mention operations must not run here.
        const createdAt = unixNow();
        const expirationTags = config.mirrorExpiration ? expiration.tags(participants, createdAt) : [];
        const template = {
          kind: kinds.PrivateDirectMessage,
          pubkey: owner.pubkey,
          created_at: createdAt,
          tags: [...new Set(request.recipients)].map((recipient) => ["p", recipient]).concat(expirationTags),
          content: request.content,
        };
        assertCurrent();
        const rumor = { ...template, id: getEventHash(template) };
        if (config.approve && !(await config.approve({ windowId: context.windowId, template: rumor })))
          throw new Error("User denied");
        assertCurrent();

        const destinations = await Promise.all(
          participants.map(async (participant) => ({ participant, relays: await deliveryRelays(participant) })),
        );
        assertCurrent();
        for (const destination of destinations) {
          if (!destination.relays.length) throw new Error(`No DM relays for ${destination.participant}`);
        }

        const publications: WrappedPublication[] = [];
        // Prepare all envelopes before publishing so rejecting a later signing prompt sends nothing.
        for (const { participant, relays } of destinations) {
          assertCurrent();
          const event = await GiftWrapFactory.create(owner.signer, participant, rumor);
          assertCurrent();
          publications.push({ recipient: participant, event, relays, accepted: false });
        }
        const message: DmProtocolMessage = {
          id: rumor.id,
          participants,
          senderPubkey: owner.pubkey,
          createdAt: rumor.created_at,
          content: rumor.content,
          status: "sent",
        };
        const delivery: WrappedDelivery = { fingerprint, message, publications, publishing: false };
        if (cacheKey) {
          // Keep a bounded session-local retry window without retaining plaintext across accounts.
          if (cache.deliveries.size >= 100) {
            const oldest = [...cache.deliveries].find(([, entry]) => !entry.publishing);
            if (!oldest) throw new Error("DM retry cache is busy");
            cache.deliveries.delete(oldest[0]);
          }
          cache.deliveries.set(cacheKey, delivery);
        }
        return { message, publish$: publishDelivery$(delivery, context) };
      }).pipe(
        timeout({ first: config.actionTimeout ?? 120000 }),
        finalize(() => {
          active = false;
          if (cacheKey && ownsPreparation) cache.preparing.delete(cacheKey);
        }),
      );
    });
  }

  const session$ = defer(() => (closed ? of(undefined) : kehtoAccount$(config))).pipe(
    map((account) => {
      if (!account || !account.signer.nip44) {
        currentAccount = undefined;
        currentSession = undefined;
        return undefined;
      }
      if (currentAccount?.signer !== account.signer || currentAccount.pubkey !== account.pubkey) {
        currentAccount = account;
        const expiration = new DmExpirationTracker();
        const cache: WrappedSendCache = { deliveries: new Map(), preparing: new Set() };
        currentSession = {
          ownerPubkey: account.pubkey,
          discover$: (request, context) => defer(() => discover(request, account, context)),
          messages$: (context) => messages$(account, context, expiration),
          prepareSend$: (request, context) => prepareSend$(request, account, context, cache, expiration),
        };
      }
      return currentSession;
    }),
    takeUntil(closed$),
  );

  return {
    id: "nip17",
    session$: merge(session$, closed$.pipe(map(() => undefined))).pipe(shareReplay({ bufferSize: 1, refCount: true })),
    close: () => {
      if (closed) return;
      closed = true;
      currentSession = undefined;
      currentAccount = undefined;
      closed$.next();
      closed$.complete();
    },
  };
}
