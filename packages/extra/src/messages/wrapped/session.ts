import type { ISigner } from "applesauce-signers";
import { castUser } from "applesauce-common/casts";
import { GiftWrapFactory, WrappedMessageFactory } from "applesauce-common/factories";
import {
  getConversationParticipants,
  getGiftWrapSeal,
  unlockGiftWrap,
  unlockSeal,
  type Rumor,
} from "applesauce-common/helpers";
import {
  getEventHash,
  isEncryptedContentUnlocked,
  kinds,
  notifyEventUpdate,
  setEncryptedContentCache,
  unlockEncryptedContent,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
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
  of,
  startWith,
  switchMap,
  takeWhile,
  timeout,
} from "rxjs";
import { subscribeThroughStore } from "../common/loading.js";
import { configured$, settle } from "../common/helpers.js";
import { DmExpirationTracker } from "../common/expiration.js";
import { restoreMessageContent, saveMessageContent } from "../common/encryption.js";
import { publishAcceptedMessage } from "../common/publication.js";
import { WrappedMessagePublicationError } from "./publication.js";
import type { MessageOperationContext } from "../common/types.js";
import type {
  WrappedMessageSendRequest,
  WrappedMessagePreparation,
  WrappedMessageAvailability,
  WrappedMessageRecipientSupport,
  WrappedMessagePublicationResult,
  WrappedMessagesClientOptions,
} from "./types.js";

type MessageAccount = { pubkey: string; signer: ISigner };

interface WrappedPublication {
  recipient: string;
  event: NostrEvent;
  relays: string[];
  accepted: boolean;
  error?: unknown;
}

interface WrappedDelivery {
  fingerprint: string;
  message: Rumor;
  publications: WrappedPublication[];
  publishing: boolean;
}

interface WrappedSendCache {
  deliveries: Map<string, WrappedDelivery>;
  preparing: Set<string>;
}

function publicationResults(delivery: WrappedDelivery): WrappedMessagePublicationResult[] {
  return delivery.publications.map((publication) => ({
    recipient: publication.recipient,
    eventId: publication.event.id,
    accepted: publication.accepted,
    error: publication.error,
  }));
}

/** A fixed-account NIP-17 session with per-participant gift wraps */
export class WrappedMessageSession {
  private readonly pendingDecryptions = new Map<string, Promise<Rumor | undefined>>();
  private closed = false;
  private readonly expiration = new DmExpirationTracker();
  private readonly cache: WrappedSendCache = { deliveries: new Map(), preparing: new Set() };
  private get wait() {
    return this.config.timeout ?? 4000;
  }

  /** Creates a session owned by a wrapped messages client */
  constructor(
    private readonly config: WrappedMessagesClientOptions,
    private readonly owner: MessageAccount,
    private readonly onReadError: (error: unknown, event: NostrEvent) => void,
  ) {}

  private fallbackRelays() {
    const { config, wait } = this;
    return settle(configured$(config.fallbackRelays, []), [], wait);
  }

  private async recipientRelays(pubkey: string): Promise<WrappedMessageRecipientSupport> {
    const { config, wait } = this;
    const user = castUser(pubkey, config.eventStore);
    const relays = await settle(user.directMessageRelays$, undefined, wait);
    return {
      recipient: pubkey,
      support: relays === undefined ? "unknown" : relays.length ? "supported" : "unsupported",
      relays,
    };
  }

  private async deliveryRelays(pubkey: string) {
    const { config, wait } = this;
    const user = castUser(pubkey, config.eventStore);
    const advertised = await settle(user.directMessageRelays$, undefined, wait);
    return advertised ?? [];
  }

  private async historyRelays(pubkey: string) {
    const advertised = await this.deliveryRelays(pubkey);
    return advertised.length ? advertised : this.fallbackRelays();
  }

  private relays$(pubkey: string) {
    const { config } = this;
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

  private validateRecipients(request: WrappedMessageSendRequest) {
    if (!request.recipients.length || request.recipients.some((recipient) => !/^[0-9a-f]{64}$/.test(recipient)))
      throw new Error("Invalid recipients");
  }

  private async discover(
    request: WrappedMessageSendRequest,
    owner: MessageAccount,
    context: MessageOperationContext,
  ): Promise<WrappedMessageAvailability> {
    context.signal.throwIfAborted();
    this.validateRecipients(request);
    const participants = [...new Set([...request.recipients, owner.pubkey])];
    const support = await Promise.all(participants.map((pubkey) => this.recipientRelays(pubkey)));
    context.signal.throwIfAborted();
    return {
      canSend: support.every((recipient) => !!recipient.relays?.length),
      support: support.every((recipient) => recipient.support === "supported")
        ? "supported"
        : support.some((recipient) => recipient.support === "unsupported")
          ? "unsupported"
          : "unknown",
      recipients: support,
    };
  }

  private async decrypt(
    event: NostrEvent,
    owner: MessageAccount,
    expiration: DmExpirationTracker,
  ): Promise<Rumor | undefined> {
    const { config } = this;
    if (event.kind !== kinds.GiftWrap) return;
    if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === owner.pubkey)) return;

    // Restore each encryption layer before asking the signer to decrypt a cache miss.
    let rumor: Rumor;
    if (config.decryptionCache) {
      await restoreMessageContent(event, config.decryptionCache);
      if (!isEncryptedContentUnlocked(event)) await unlockEncryptedContent(event, event.pubkey, owner.signer);

      const seal = getGiftWrapSeal(event);
      if (!seal) throw new Error("Failed to read seal in gift wrap");

      await restoreMessageContent(seal, config.decryptionCache);
      rumor = await unlockSeal(seal, owner.signer);
      notifyEventUpdate(event);

      await saveMessageContent(event, config.decryptionCache);
      await saveMessageContent(seal, config.decryptionCache);
    } else {
      rumor = await unlockGiftWrap(event, owner.signer);
    }
    const participants = getConversationParticipants(rumor);
    if (rumor.kind !== kinds.PrivateDirectMessage || !participants.includes(owner.pubkey)) return;
    if (config.mirrorExpiration) expiration.observe(rumor, participants);
    return rumor;
  }

  private readMessage$(event: NostrEvent, owner: MessageAccount, expiration: DmExpirationTracker) {
    const { config } = this;
    return defer(() => {
      const pending = this.pendingDecryptions;
      let decryption = pending.get(event.id);
      if (!decryption) {
        decryption = this.decrypt(event, owner, expiration);
        pending.set(event.id, decryption);
        // Unresolved signer promises stay shared when an individual reader times out.
        const release = () => pending.delete(event.id);
        void decryption.then(release, release);
      }
      return decryption;
    }).pipe(
      timeout({ first: config.decryptionTimeout ?? 60000 }),
      filter((message): message is Rumor => !!message),
    );
  }

  /** Streams a finite or live decrypted mailbox */
  messages$(context: MessageOperationContext & { history: boolean }) {
    const { owner, config, expiration } = this;
    return defer(() => {
      context.signal.throwIfAborted();
      let active = true;
      const seen = new Set<string>();
      const mailboxFilter = { kinds: [kinds.GiftWrap], "#p": [owner.pubkey] };
      const targets$ = context.history ? defer(() => this.historyRelays(owner.pubkey)) : this.relays$(owner.pubkey);

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
            return this.readMessage$(event, owner, expiration).pipe(
              catchError((error) => {
                this.onReadError(error, event);
                return EMPTY;
              }),
            );
          }),
        ),
        finalize(() => {
          active = false;
        }),
      );
    });
  }

  private publishDelivery$(delivery: WrappedDelivery, context: MessageOperationContext) {
    const { config } = this;
    return defer(async () => {
      context.signal.throwIfAborted();
      if (this.closed) throw new Error("DM protocol closed");
      if (delivery.publishing) throw new Error("DM message is already being published");
      delivery.publishing = true;

      try {
        for (const publication of delivery.publications) {
          context.signal.throwIfAborted();
          if (this.closed) throw new Error("DM protocol closed");
          if (publication.accepted) continue;

          try {
            await publishAcceptedMessage(config, publication.relays, publication.event, context.signal);
            publication.accepted = true;
            publication.error = undefined;
          } catch (error) {
            publication.error = error;
          }
        }
        context.signal.throwIfAborted();

        const results = publicationResults(delivery);
        if (results.some((result) => !result.accepted))
          throw new WrappedMessagePublicationError(delivery.message, results);
        return delivery.message;
      } finally {
        delivery.publishing = false;
      }
    });
  }

  /** Prepares every participant's envelope before allowing publication */
  prepareSend$(request: WrappedMessageSendRequest, context: MessageOperationContext) {
    const { config, owner, cache, expiration } = this;
    return defer(() => {
      let active = true;
      const cacheKey = request.clientMessageId ? JSON.stringify([context.scope, request.clientMessageId]) : undefined;
      const fingerprint = JSON.stringify([
        [...new Set(request.recipients)].sort(),
        request.content,
        request.replyTo,
        request.expiration,
        request.envelopeExpiration,
      ]);
      let ownsPreparation = false;
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        if (!active || this.closed) throw new Error("DM protocol operation ended");
      };
      return defer(async (): Promise<WrappedMessagePreparation> => {
        this.validateRecipients(request);
        assertCurrent();
        if (cacheKey) {
          const previous = cache.deliveries.get(cacheKey);
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw new Error("DM clientMessageId belongs to another message");
            return this.prepared(previous);
          }
          if (cache.preparing.has(cacheKey)) throw new Error("DM message is already being prepared");
          cache.preparing.add(cacheKey);
          ownsPreparation = true;
        }

        const participants = [...new Set([...request.recipients, owner.pubkey])];
        // In NIP-17 every p tag is a recipient, so note mention operations must not run here.
        const createdAt = unixNow();
        const expirationTags =
          request.expiration !== undefined
            ? [["expiration", String(request.expiration)]]
            : config.mirrorExpiration
              ? expiration.tags(participants, createdAt)
              : [];
        let factory = WrappedMessageFactory.create([...new Set(request.recipients)], request.content).created(
          createdAt,
        );
        if (expirationTags.length) factory = factory.expiration(Number(expirationTags[0][1]));
        if (request.replyTo) factory = factory.replyTo(request.replyTo);
        const template = await factory.as(owner.signer).stamp();
        assertCurrent();
        const rumor = { ...template, id: getEventHash(template) };
        const destinations = await Promise.all(
          participants.map(async (participant) => ({ participant, relays: await this.deliveryRelays(participant) })),
        );
        assertCurrent();
        for (const destination of destinations) {
          if (!destination.relays.length) throw new Error(`No DM relays for ${destination.participant}`);
        }
        if (config.approve && !(await config.approve({ scope: context.scope, template: rumor })))
          throw new Error("User denied");
        assertCurrent();

        const publications: WrappedPublication[] = [];
        // Prepare all envelopes before publishing so rejecting a later signing prompt sends nothing.
        for (const { participant, relays } of destinations) {
          assertCurrent();
          const event = await GiftWrapFactory.create(owner.signer, participant, rumor, {
            expiration: request.envelopeExpiration,
          });
          assertCurrent();
          if (config.decryptionCache && participant === owner.pubkey) {
            const seal = getGiftWrapSeal(event)!;
            setEncryptedContentCache(seal, JSON.stringify(rumor));
            await saveMessageContent(event, config.decryptionCache);
            await saveMessageContent(seal, config.decryptionCache);
            assertCurrent();
          }
          publications.push({ recipient: participant, event, relays, accepted: false });
        }
        const delivery: WrappedDelivery = { fingerprint, message: rumor, publications, publishing: false };
        if (cacheKey) {
          // Keep a bounded session-local retry window without retaining plaintext across accounts.
          if (cache.deliveries.size >= 100) {
            const oldest = [...cache.deliveries].find(([, entry]) => !entry.publishing);
            if (!oldest) throw new Error("DM retry cache is busy");
            cache.deliveries.delete(oldest[0]);
          }
          cache.deliveries.set(cacheKey, delivery);
        }
        return this.prepared(delivery);
      }).pipe(
        timeout({ first: config.actionTimeout ?? 120000 }),
        finalize(() => {
          active = false;
          if (cacheKey && ownsPreparation) cache.preparing.delete(cacheKey);
        }),
      );
    });
  }

  private prepared(delivery: WrappedDelivery): WrappedMessagePreparation {
    return {
      message: delivery.message,
      get publications() {
        return publicationResults(delivery);
      },
      publish$: (context) => this.publishDelivery$(delivery, context),
    };
  }

  /** Discovers every participant's advertised DM relays */
  discover$(request: WrappedMessageSendRequest, context: MessageOperationContext) {
    return defer(() => this.discover(request, this.owner, context));
  }

  /** Decrypts one envelope while sharing outstanding signer calls */
  read$(event: NostrEvent) {
    return this.readMessage$(event, this.owner, this.expiration);
  }

  /** Invalidates the session and releases retained envelopes */
  close(): void {
    this.closed = true;
    this.cache.deliveries.clear();
    this.cache.preparing.clear();
  }
}
