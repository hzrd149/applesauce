import type { DmSendRequest } from "@kehto/services";
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
  type Filter,
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
  merge,
  Observable,
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
import { restoreMessageContent, saveMessageContent } from "./encryption.js";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import { publishAcceptedMessage } from "./publication.js";
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

function mergeRelays(...lists: (readonly string[] | undefined)[]) {
  return [...new Set(lists.flatMap((list) => list ?? []))];
}

/** Creates a NIP-04 protocol with legacy direct messages and inbox/outbox relay routing */
export function createLegacyMessageProtocol(config: NostrMessageProtocolOptions): DmProtocolAdapter {
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

  async function deliveryRelays(pubkey: string) {
    const user = castUser(pubkey, config.eventStore);
    const direct = settle(user.directMessageRelays$, undefined, wait);
    const inboxes = settle(user.inboxes$, undefined, wait);
    const [dm, inbox] = await Promise.all([direct, inboxes]);
    const advertised = mergeRelays(dm, inbox);
    return advertised.length ? advertised : fallbackRelays();
  }

  function relays$(pubkey: string, direction: "incoming" | "outgoing") {
    const user = castUser(pubkey, config.eventStore);
    const advertised$: Observable<string[] | undefined> =
      direction === "outgoing"
        ? user.outboxes$
        : combineLatest([user.inboxes$, user.directMessageRelays$]).pipe(map(([inbox, dm]) => mergeRelays(inbox, dm)));
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

  function validateRecipients(request: DmSendRequest, owner: KehtoAccount) {
    if (!request.recipients.length || request.recipients.some((recipient) => !/^[0-9a-f]{64}$/.test(recipient)))
      throw new Error("Invalid recipients");
    if (request.recipients.filter((recipient) => recipient !== owner.pubkey).length > 1)
      throw new Error("Legacy messages require one recipient");
  }

  async function discover(
    request: DmSendRequest,
    owner: KehtoAccount,
    context: DmOperationContext,
  ): Promise<DmProtocolAvailability> {
    context.signal.throwIfAborted();
    validateRecipients(request, owner);
    const peers = request.recipients.filter((recipient) => recipient !== owner.pubkey);
    const recipients = peers.length ? peers : [owner.pubkey];
    const [support, fallback] = await Promise.all([Promise.all(recipients.map(recipientRelays)), fallbackRelays()]);
    context.signal.throwIfAborted();
    return {
      canSend: support.every((recipient) => !!recipient.relays?.length || fallback.length > 0),
      support: support.every((recipient) => recipient.support === "supported")
        ? "supported"
        : support.some((recipient) => recipient.support === "unsupported")
          ? "unsupported"
          : "unknown",
      recipients: support,
      hasFallback: fallback.length > 0,
    };
  }

  async function decrypt(
    event: NostrEvent,
    owner: KehtoAccount,
    expiration: DmExpirationTracker,
  ): Promise<DmProtocolMessage | undefined> {
    if (event.pubkey !== owner.pubkey && !event.tags.some((tag) => tag[0] === "p" && tag[1] === owner.pubkey)) return;
    const correspondent = getLegacyMessageCorrespondent(event, owner.pubkey);
    if (!correspondent) return;
    await restoreMessageContent(event, config.decryptionCache);
    const content = getEncryptedContent(event) ?? (await unlockLegacyMessage(event, owner.pubkey, owner.signer));
    await saveMessageContent(event, config.decryptionCache);
    if (config.mirrorExpiration) expiration.observe(event, [owner.pubkey, correspondent]);
    return {
      id: event.id,
      participants: [...new Set([owner.pubkey, correspondent])],
      senderPubkey: event.pubkey,
      createdAt: event.created_at,
      content,
      status: event.pubkey === owner.pubkey ? "sent" : "received",
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
      const incoming = { kinds: [kinds.EncryptedDirectMessage], "#p": [owner.pubkey] };
      const mailboxes: { direction: "incoming" | "outgoing"; filter: Filter }[] = [
        { direction: "incoming", filter: incoming },
        {
          direction: "outgoing",
          filter: {
            kinds: [kinds.EncryptedDirectMessage],
            authors: [owner.pubkey],
          },
        },
      ];

      return merge(
        ...mailboxes.map(({ direction, filter: mailboxFilter }) => {
          const targets$ = context.history
            ? defer(async () => {
                if (direction === "incoming") return deliveryRelays(owner.pubkey);
                const outboxes = await settle(castUser(owner.pubkey, config.eventStore).outboxes$, undefined, wait);
                return outboxes?.length ? outboxes : fallbackRelays();
              })
            : relays$(owner.pubkey, direction);
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
            return readMessage$(event, owner, expiration);
          }),
        ),
        finalize(() => {
          active = false;
        }),
      );
    });
  }

  function prepareSend$(
    request: DmSendRequest,
    owner: KehtoAccount,
    context: DmOperationContext,
    expiration: DmExpirationTracker,
  ) {
    return defer(() => {
      let active = true;
      const assertCurrent = () => {
        context.signal.throwIfAborted();
        if (!active || closed) throw new Error("DM protocol operation ended");
      };
      return defer(async (): Promise<DmPreparedSend> => {
        validateRecipients(request, owner);
        assertCurrent();
        const participants = [...new Set([...request.recipients, owner.pubkey])];
        const recipient = request.recipients.find((key) => key !== owner.pubkey) ?? owner.pubkey;
        const createdAt = unixNow();
        const expirationTags = config.mirrorExpiration ? expiration.tags(participants, createdAt) : [];
        const template = {
          kind: kinds.EncryptedDirectMessage,
          pubkey: owner.pubkey,
          created_at: createdAt,
          content: request.content,
          tags: [["p", recipient], ...expirationTags],
        };
        assertCurrent();
        const rumor = { ...template, id: getEventHash(template) };
        if (config.approve && !(await config.approve({ windowId: context.windowId, template: rumor })))
          throw new Error("User denied");
        assertCurrent();

        let factory = LegacyMessageFactory.create(recipient, request.content).created(createdAt);
        if (expirationTags.length) factory = factory.expiration(Number(expirationTags[0][1]));
        const event = await factory.sign(owner.signer);
        assertCurrent();
        if (config.decryptionCache) {
          setEncryptedContentCache(event, request.content);
          await saveMessageContent(event, config.decryptionCache);
          assertCurrent();
        }
        const [inboxes, outboxes] = await Promise.all([
          deliveryRelays(recipient),
          settle(castUser(owner.pubkey, config.eventStore).outboxes$, [], wait),
        ]);
        assertCurrent();
        const relays = mergeRelays(inboxes, outboxes);
        if (!relays.length) throw new Error("No legacy DM relays");

        const message: DmProtocolMessage = {
          id: event.id,
          participants,
          senderPubkey: owner.pubkey,
          createdAt: event.created_at,
          content: request.content,
          status: "sent",
        };
        return {
          message,
          publish$: defer(async () => {
            // Publication has its own lifetime; completing prepareSend$ only ends preparation.
            context.signal.throwIfAborted();
            if (closed) throw new Error("DM protocol closed");
            await publishAcceptedMessage(config, relays, event);
            context.signal.throwIfAborted();
            return message;
          }),
        };
      }).pipe(
        timeout({ first: config.actionTimeout ?? 120000 }),
        finalize(() => {
          active = false;
        }),
      );
    });
  }

  const session$ = defer(() => (closed ? of(undefined) : kehtoAccount$(config))).pipe(
    map((account) => {
      if (!account || !account.signer.nip04) {
        currentAccount = undefined;
        currentSession = undefined;
        return undefined;
      }
      if (currentAccount?.signer !== account.signer || currentAccount.pubkey !== account.pubkey) {
        currentAccount = account;
        const expiration = new DmExpirationTracker();
        currentSession = {
          ownerPubkey: account.pubkey,
          discover$: (request, context) => defer(() => discover(request, account, context)),
          messages$: (context) => messages$(account, context, expiration),
          prepareSend$: (request, context) => prepareSend$(request, account, context, expiration),
        };
      }
      return currentSession;
    }),
    takeUntil(closed$),
  );

  return {
    id: "nip04",
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
