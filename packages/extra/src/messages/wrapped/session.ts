import { logger } from "applesauce-core";
import type { ISigner } from "applesauce-signers";
import { castUser } from "applesauce-common/casts";
import { FileMessageFactory, GiftWrapFactory, WrappedMessageFactory } from "applesauce-common/factories";
import { getConversationParticipants, getGiftWrapSeal, type Rumor } from "applesauce-common/helpers";
import {
  saveEncryptedContent,
  isEncryptedContentFromCache,
  addSeenRelay,
  getEventHash,
  isHexKey,
  setEncryptedContentCache,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import { defer, finalize, firstValueFrom, timeout } from "rxjs";
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
  private closed = false;
  private expiration = new WrappedMessageExpirationTracker();
  private get wait() {
    return this.config.timeout ?? 4000;
  }

  /** Creates a session owned by a wrapped messages client */
  constructor(
    private readonly config: WrappedMessagesClientOptions,
    private readonly owner: MessageAccount,
    private readonly onSelfPublication: (event: NostrEvent, signal: AbortSignal) => Promise<void>,
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

  /** Replaces expiration preferences with the currently available message timeline */
  observeMessages(messages: Rumor[]): void {
    this.expiration = new WrappedMessageExpirationTracker();
    for (const message of messages) this.expiration.observe(message, getConversationParticipants(message));
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
            // Local processing failures must not turn accepted delivery into a network retry.
            if (publication.recipient === this.owner.pubkey) {
              await this.onSelfPublication(publication.event, context.signal);
            }
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
        const recipients = [...new Set(request.recipients)];
        let factory = (
          request.file
            ? FileMessageFactory.create(recipients, request.file)
            : WrappedMessageFactory.create(recipients, request.content)
        ).created(createdAt);
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
          if (participant === owner.pubkey) {
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

  /** Invalidates the session and its outstanding operations */
  close(): void {
    this.closed = true;
  }
}
