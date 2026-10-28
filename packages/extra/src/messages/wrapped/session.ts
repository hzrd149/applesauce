import { logger } from "applesauce-core";
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
  restoreEncryptedContent,
  saveEncryptedContent,
  isEncryptedContentFromCache,
  addSeenRelay,
  getEventHash,
  isEncryptedContentUnlocked,
  isHexKey,
  kinds,
  notifyEventUpdate,
  setEncryptedContentCache,
  unlockEncryptedContent,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import { catchError, concatMap, defer, EMPTY, filter, finalize, from, firstValueFrom, timeout } from "rxjs";
import { withMessageAuth$ } from "../common/authentication.js";
import { settle } from "../common/helpers.js";
import { WrappedMessageExpirationTracker } from "./expiration.js";
import { WrappedMessagePublicationError } from "./publication.js";
import type {
  WrappedMessageSendRequest,
  WrappedMessagePreparation,
  WrappedMessageAvailability,
  WrappedMessageRecipientSupport,
  WrappedMessagePublicationResult,
  WrappedMessagesClientOptions,
} from "./types.js";

const log = logger.extend("WrappedMessages");

type MessageAccount = { pubkey: string; signer: ISigner };

interface WrappedPublication {
  recipient: string;
  event: NostrEvent;
  relays: string[];
  accepted: boolean;
  error?: unknown;
}

interface WrappedDelivery {
  message: Rumor;
  publications: WrappedPublication[];
  publishing: boolean;
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
  private readonly expiration = new WrappedMessageExpirationTracker();
  private get wait() {
    return this.config.timeout ?? 4000;
  }

  /** Creates a session owned by a wrapped messages client */
  constructor(
    private readonly config: WrappedMessagesClientOptions,
    private readonly owner: MessageAccount,
    private readonly onReadError: (error: unknown, event: NostrEvent) => void,
  ) {}

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

  private validateRecipients(request: WrappedMessageSendRequest) {
    if (!request.recipients.length || request.recipients.some((recipient) => !isHexKey(recipient)))
      throw new Error("Invalid recipients");
  }

  private async discover(
    request: WrappedMessageSendRequest,
    owner: MessageAccount,
    context: { signal: AbortSignal },
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
    expiration: WrappedMessageExpirationTracker,
  ): Promise<Rumor | undefined> {
    const { config } = this;
    if (event.kind !== kinds.GiftWrap) return;
    if (!event.tags.some((tag) => tag[0] === "p" && tag[1] === owner.pubkey)) return;

    // Restore each encryption layer before asking the signer to decrypt a cache miss.
    let rumor: Rumor;
    if (config.decryptionCache) {
      await restoreEncryptedContent(event, config.decryptionCache).catch((error) => {
        log("Failed to restore encrypted content for %s", event.id, error);
      });
      if (!isEncryptedContentUnlocked(event)) await unlockEncryptedContent(event, event.pubkey, owner.signer);

      const seal = getGiftWrapSeal(event);
      if (!seal) throw new Error("Failed to read seal in gift wrap");

      await restoreEncryptedContent(seal, config.decryptionCache).catch((error) => {
        log("Failed to restore encrypted content for %s", seal.id, error);
      });
      rumor = await unlockSeal(seal, owner.signer);
      notifyEventUpdate(event);

      if (!isEncryptedContentFromCache(event)) {
        await saveEncryptedContent(event, config.decryptionCache).catch((error) => {
          log("Failed to persist encrypted content for %s", event.id, error);
        });
      }
      if (!isEncryptedContentFromCache(seal)) {
        await saveEncryptedContent(seal, config.decryptionCache).catch((error) => {
          log("Failed to persist encrypted content for %s", seal.id, error);
        });
      }
    } else {
      rumor = await unlockGiftWrap(event, owner.signer);
    }
    const participants = getConversationParticipants(rumor);
    if (rumor.kind !== kinds.PrivateDirectMessage || !participants.includes(owner.pubkey)) return;
    if (config.mirrorExpiration) expiration.observe(rumor, participants);
    return rumor;
  }

  private readMessage$(event: NostrEvent, owner: MessageAccount, expiration: WrappedMessageExpirationTracker) {
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

  /** Reads a stored envelope snapshot or watches the store for additions */
  messages$(context: { signal: AbortSignal; history: boolean }) {
    const { owner, config, expiration } = this;
    return defer(() => {
      context.signal.throwIfAborted();
      let active = true;
      const seen = new Set<string>();
      const mailboxFilter = { kinds: [kinds.GiftWrap], "#p": [owner.pubkey] };
      const events$ = context.history
        ? from(config.eventStore.getByFilters(mailboxFilter))
        : config.eventStore.filters(mailboxFilter);

      return events$.pipe(
        // Decrypt each stored envelope once per reader.
        filter((event) => {
          if (seen.has(event.id)) return false;
          seen.add(event.id);
          return true;
        }),
        // Decrypt in order and report one envelope failure without ending the mailbox.
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
        // Prevent queued work after unsubscription; in-flight signer promises remain shared.
        finalize(() => {
          active = false;
        }),
      );
    });
  }

  private publishDelivery$(delivery: WrappedDelivery, context: { signal: AbortSignal }) {
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
            // Release auth prompts on cancellation, but retain late acceptance to prevent resending.
            const results = await firstValueFrom(
              withMessageAuth$(
                config,
                (auth) => defer(() => config.pool.publish(publication.relays, publication.event, auth)),
                context.signal,
              ),
            );

            if (!results.some((result) => result.ok)) {
              throw new Error(results[0]?.message ?? "No relay accepted the event");
            }

            for (const result of results) {
              if (result.ok) addSeenRelay(publication.event, result.from);
            }
            config.eventStore.add(publication.event);

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
  prepareSend$(request: WrappedMessageSendRequest, context: { signal: AbortSignal }) {
    const { config, owner, expiration } = this;
    return defer(() => {
      // Keep cancellation guards local to this preparation.
      let active = true;
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        if (!active || this.closed) throw new Error("DM protocol operation ended");
      };
      return defer(async (): Promise<WrappedMessagePreparation> => {
        this.validateRecipients(request);
        assertCurrent();
        const participants = [...new Set([...request.recipients, owner.pubkey])];
        // In NIP-17 every p tag is a recipient, so note mention operations must not run here.
        const createdAt = unixNow();
        const expirationTimestamp =
          request.expiration ?? (config.mirrorExpiration ? expiration.expiration(participants, createdAt) : undefined);
        let factory = WrappedMessageFactory.create([...new Set(request.recipients)], request.content).created(
          createdAt,
        );
        if (expirationTimestamp !== undefined) factory = factory.expiration(expirationTimestamp);
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
            if (config.decryptionCache && !isEncryptedContentFromCache(event)) {
              await saveEncryptedContent(event, config.decryptionCache).catch((error) => {
                log("Failed to persist encrypted content for %s", event.id, error);
              });
            }
            if (config.decryptionCache && !isEncryptedContentFromCache(seal)) {
              await saveEncryptedContent(seal, config.decryptionCache).catch((error) => {
                log("Failed to persist encrypted content for %s", seal.id, error);
              });
            }
            assertCurrent();
          }
          publications.push({ recipient: participant, event, relays, accepted: false });
        }
        const delivery: WrappedDelivery = { message: rumor, publications, publishing: false };
        return this.prepared(delivery);
      }).pipe(
        timeout({ first: config.actionTimeout ?? 120000 }),
        // Invalidate late signer results when preparation ends.
        finalize(() => {
          active = false;
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
  discover$(request: WrappedMessageSendRequest, context: { signal: AbortSignal }) {
    return defer(() => this.discover(request, this.owner, context));
  }

  /** Decrypts one envelope while sharing outstanding signer calls */
  read$(event: NostrEvent) {
    return this.readMessage$(event, this.owner, this.expiration);
  }

  /** Invalidates the session and its outstanding operations */
  close(): void {
    this.closed = true;
  }
}
