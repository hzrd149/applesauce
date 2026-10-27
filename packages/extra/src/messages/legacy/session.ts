import type { ISigner } from "applesauce-signers";
import { castUser } from "applesauce-common/casts";
import { LegacyMessageFactory } from "applesauce-common/factories";
import { getLegacyMessageCorrespondent, unlockLegacyMessage } from "applesauce-common/helpers";
import {
  getEncryptedContent,
  getEventHash,
  kinds,
  setEncryptedContentCache,
  unixNow,
  type NostrEvent,
} from "applesauce-core/helpers";
import { catchError, concatMap, defer, EMPTY, filter, finalize, merge, switchMap, takeWhile, timeout } from "rxjs";
import { subscribeThroughStore } from "../common/loading.js";
import { createLegacyMailboxes } from "./loading.js";
import { configured$, settle } from "../common/helpers.js";
import { DmExpirationTracker } from "../common/expiration.js";
import { restoreMessageContent, saveMessageContent } from "../common/encryption.js";
import { publishAcceptedMessage } from "../common/publication.js";
import type { MessageOperationContext } from "../common/types.js";
import type {
  LegacyMessageSendRequest,
  LegacyMessagePreparation,
  LegacyMessageAvailability,
  LegacyMessagesClientOptions,
} from "./types.js";

type MessageAccount = { pubkey: string; signer: ISigner };

interface LegacyDelivery {
  fingerprint: string;
  event: NostrEvent;
  relays: string[];
  accepted: boolean;
  publishing: boolean;
}

function mergeRelays(...lists: (readonly string[] | undefined)[]) {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

/** A fixed-account NIP-04 session with inbox/outbox routing */
export class LegacyMessageSession {
  private readonly pendingDecryptions = new Map<string, Promise<NostrEvent | undefined>>();
  private closed = false;
  private readonly expiration = new DmExpirationTracker();
  private readonly deliveries = new Map<string, LegacyDelivery>();
  private readonly preparing = new Set<string>();
  private get wait() {
    return this.config.timeout ?? 4000;
  }

  /** Creates a session owned by a legacy messages client */
  constructor(
    private readonly config: LegacyMessagesClientOptions,
    private readonly owner: MessageAccount,
    private readonly onReadError: (error: unknown, event: NostrEvent) => void,
  ) {}

  private fallbackRelays() {
    const { config, wait } = this;
    return settle(configured$(config.fallbackRelays, []), [], wait);
  }

  private async recipientRelays(
    pubkey: string,
  ): Promise<Pick<LegacyMessageAvailability, "recipient" | "support" | "relays">> {
    const { config, wait } = this;
    const user = castUser(pubkey, config.eventStore);
    const [inboxes, direct] = await Promise.all([
      settle(user.inboxes$, undefined, wait),
      settle(user.directMessageRelays$, undefined, wait),
    ]);
    const relays = mergeRelays(inboxes, direct);
    return {
      recipient: pubkey,
      support: inboxes === undefined ? "unknown" : inboxes.length ? "supported" : "unsupported",
      relays,
    };
  }

  private async deliveryRelays(pubkey: string) {
    const { config, wait } = this;
    const user = castUser(pubkey, config.eventStore);
    const direct = settle(user.directMessageRelays$, undefined, wait);
    const inboxes = settle(user.inboxes$, undefined, wait);
    const [dm, inbox] = await Promise.all([direct, inboxes]);
    const advertised = mergeRelays(dm, inbox);
    return advertised.length ? advertised : this.fallbackRelays();
  }

  private validateRecipient(request: LegacyMessageSendRequest) {
    if (!/^[0-9a-f]{64}$/.test(request.recipient)) throw new Error("Invalid recipient");
  }

  private async discover(
    request: LegacyMessageSendRequest,
    context: MessageOperationContext,
  ): Promise<LegacyMessageAvailability> {
    context.signal.throwIfAborted();
    this.validateRecipient(request);
    const [support, fallback] = await Promise.all([this.recipientRelays(request.recipient), this.fallbackRelays()]);
    context.signal.throwIfAborted();
    return {
      ...support,
      canSend: !!support.relays?.length || fallback.length > 0,
      hasFallback: fallback.length > 0,
    };
  }

  private async decrypt(
    event: NostrEvent,
    owner: MessageAccount,
    expiration: DmExpirationTracker,
  ): Promise<NostrEvent | undefined> {
    const { config } = this;
    if (event.kind !== kinds.EncryptedDirectMessage) return;
    if (event.pubkey !== owner.pubkey && !event.tags.some((tag) => tag[0] === "p" && tag[1] === owner.pubkey)) return;
    const correspondent = getLegacyMessageCorrespondent(event, owner.pubkey);
    if (!correspondent) return;
    await restoreMessageContent(event, config.decryptionCache);
    if (getEncryptedContent(event) === undefined) await unlockLegacyMessage(event, owner.pubkey, owner.signer);
    await saveMessageContent(event, config.decryptionCache);
    if (config.mirrorExpiration) expiration.observe(event, [owner.pubkey, correspondent]);
    return event;
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
      filter((message): message is NostrEvent => !!message),
    );
  }

  /** Streams a finite or live decrypted mailbox */
  messages$(context: MessageOperationContext & { history: boolean }) {
    const { owner, config, expiration, wait } = this;
    return defer(() => {
      context.signal.throwIfAborted();
      let active = true;
      const seen = new Set<string>();
      const mailboxes = createLegacyMailboxes(config);

      return merge(
        ...mailboxes.map(({ relays$, filter: mailboxFilter }) => {
          const targets$ = context.history
            ? defer(() => settle(relays$.pipe(filter((relays) => relays.length > 0)), [], wait))
            : relays$;
          return targets$.pipe(
            switchMap((relays) => {
              const source$ = subscribeThroughStore(config, relays, [mailboxFilter]);
              return context.history ? source$.pipe(takeWhile((event) => event !== "EOSE", true)) : source$;
            }),
          );
        }),
      ).pipe(
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

  /** Prepares a signed legacy event without publishing it */
  prepareSend$(request: LegacyMessageSendRequest, context: MessageOperationContext) {
    const { config, owner, expiration, wait } = this;
    return defer(() => {
      let active = true;
      const key = request.clientMessageId ? JSON.stringify([context.scope, request.clientMessageId]) : undefined;
      const fingerprint = JSON.stringify([request.recipient, request.content, request.replyTo, request.expiration]);
      let ownsPreparation = false;
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        if (!active || this.closed) throw new Error("DM protocol operation ended");
      };
      return defer(async (): Promise<LegacyMessagePreparation> => {
        this.validateRecipient(request);
        assertCurrent();
        if (key) {
          const previous = this.deliveries.get(key);
          if (previous) {
            if (previous.fingerprint !== fingerprint) throw new Error("DM clientMessageId belongs to another message");
            return this.prepared(previous);
          }
          if (this.preparing.has(key)) throw new Error("DM message is already being prepared");
          this.preparing.add(key);
          ownsPreparation = true;
        }
        const recipient = request.recipient;
        const participants = [...new Set([recipient, owner.pubkey])];
        const createdAt = unixNow();
        const expirationTags =
          request.expiration !== undefined
            ? [["expiration", String(request.expiration)]]
            : config.mirrorExpiration
              ? expiration.tags(participants, createdAt)
              : [];
        const template = {
          kind: kinds.EncryptedDirectMessage,
          pubkey: owner.pubkey,
          created_at: createdAt,
          content: request.content,
          tags: [["p", recipient], ...expirationTags, ...(request.replyTo ? [["e", request.replyTo]] : [])],
        };
        assertCurrent();
        const rumor = { ...template, id: getEventHash(template) };
        if (config.approve && !(await config.approve({ scope: context.scope, template: rumor })))
          throw new Error("User denied");
        assertCurrent();

        let factory = LegacyMessageFactory.create(recipient, request.content).created(createdAt);
        if (request.replyTo) factory = factory.replyTo(request.replyTo);
        if (expirationTags.length) factory = factory.expiration(Number(expirationTags[0][1]));
        const event = await factory.sign(owner.signer);
        assertCurrent();
        setEncryptedContentCache(event, request.content);
        if (config.decryptionCache) {
          await saveMessageContent(event, config.decryptionCache);
          assertCurrent();
        }
        const [inboxes, outboxes] = await Promise.all([
          this.deliveryRelays(recipient),
          settle(castUser(owner.pubkey, config.eventStore).outboxes$, [], wait),
        ]);
        assertCurrent();
        const relays = mergeRelays(inboxes, outboxes);
        if (!relays.length) throw new Error("No legacy DM relays");

        const delivery: LegacyDelivery = { fingerprint, event, relays, accepted: false, publishing: false };
        if (key) {
          if (this.deliveries.size >= 100) {
            const oldest = [...this.deliveries].find(([, delivery]) => !delivery.publishing);
            if (!oldest) throw new Error("DM retry cache is busy");
            this.deliveries.delete(oldest[0]);
          }
          this.deliveries.set(key, delivery);
        }
        return this.prepared(delivery);
      }).pipe(
        timeout({ first: config.actionTimeout ?? 120000 }),
        finalize(() => {
          active = false;
          if (key && ownsPreparation) this.preparing.delete(key);
        }),
      );
    });
  }

  private prepared(delivery: LegacyDelivery): LegacyMessagePreparation {
    return {
      message: delivery.event,
      publish$: (context) =>
        defer(async () => {
          context.signal.throwIfAborted();
          if (this.closed) throw new Error("DM protocol closed");
          if (delivery.publishing) throw new Error("DM message is already being published");
          if (delivery.accepted) return delivery.event;
          delivery.publishing = true;
          try {
            await publishAcceptedMessage(this.config, delivery.relays, delivery.event, context.signal);
            delivery.accepted = true;
            context.signal.throwIfAborted();
            return delivery.event;
          } finally {
            delivery.publishing = false;
          }
        }),
    };
  }

  /** Discovers the recipient's advertised relays */
  discover$(request: LegacyMessageSendRequest, context: MessageOperationContext) {
    return defer(() => this.discover(request, context));
  }

  /** Decrypts one event while sharing outstanding signer calls */
  read$(event: NostrEvent) {
    return this.readMessage$(event, this.owner, this.expiration);
  }

  /** Invalidates the session */
  close(): void {
    this.closed = true;
    this.deliveries.clear();
    this.preparing.clear();
  }
}
