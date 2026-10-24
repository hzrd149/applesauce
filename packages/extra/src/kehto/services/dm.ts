import type { EventStore } from "applesauce-core";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { Observable } from "rxjs";
import type { KehtoSignRequest } from "../types.js";
import { DmMemoryStore, type DmAdapter, type DmMessage, type DmServiceOptions } from "@kehto/services";
import { castUser } from "applesauce-common/casts";
import { GiftWrapFactory, WrappedMessageFactory } from "applesauce-common/factories";
import { getConversationParticipants, unlockGiftWrap, type Rumor } from "applesauce-common/helpers";
import { getEventHash, kinds, type NostrEvent } from "applesauce-core/helpers";
import { filter, finalize, firstValueFrom, Subscription, takeUntil } from "rxjs";
import { type KehtoAccount, kehtoAccount$ } from "../foundation/account.js";
import { publishThroughStore, queryThroughStore, subscribeThroughStore } from "../foundation/pool.js";
import { configured$, settle } from "../helpers.js";

/** Options for {@link createDmOptions} */
export interface KehtoDmOptions {
  /** The shared event store with host loaders configured */
  eventStore: EventStore;
  /** The relay pool used for napplet traffic */
  pool: RelayPool;
  /** The signer or reactive active signer */
  signer?: ISigner | Observable<ISigner | undefined>;
  /** The shared resolved account stream, overriding signer resolution when provided */
  account$?: Observable<KehtoAccount | undefined>;
  /** The wait for missing data in milliseconds (default 4000) */
  timeout?: number;
  /** The relays used when user relay lists are unavailable */
  fallbackRelays?: string[] | Observable<string[]>;
  /** The host callback approving a napplet signing request */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
  /** The napplet window making the current request */
  getWindowId?: () => string | undefined;
}

/** Creates NIP-17 DM options using the host signer and shared encrypted event store */
export function createDmOptions(config: KehtoDmOptions): DmServiceOptions {
  const subscriptions = new Map<string, Subscription>();
  let nextSubscriptionId = 0;

  async function getAccount() {
    const account = await firstValueFrom(kehtoAccount$(config));
    if (!account?.signer.nip44) throw new Error("NIP-44 signer required");
    return account;
  }

  async function isCurrentAccount(owner: KehtoAccount) {
    const current = await firstValueFrom(kehtoAccount$(config));
    return current?.signer === owner.signer && current.pubkey === owner.pubkey;
  }

  async function getInboxRelays(pubkey: string) {
    const user = castUser(pubkey, config.eventStore);
    const relays = await settle(user.directMessageRelays$, [] as string[], config.timeout ?? 4000);
    return relays.length
      ? relays
      : await firstValueFrom(configured$(config.fallbackRelays, []));
  }

  function storeMessage(rumor: Rumor, pubkey: string, messages: DmMemoryStore): DmMessage {
    const participants = getConversationParticipants(rumor);
    const message: DmMessage = {
      id: rumor.id,
      conversationId: messages.conversationIdFor(participants),
      senderPubkey: rumor.pubkey,
      createdAt: rumor.created_at,
      content: rumor.content,
      status: rumor.pubkey === pubkey ? "sent" : "received",
    };
    return messages.upsertMessage(message, participants);
  }

  async function readMessage(gift: NostrEvent, owner: KehtoAccount, messages: DmMemoryStore) {
    try {
      const rumor = await unlockGiftWrap(gift, owner.signer);
      if (!(await isCurrentAccount(owner))) return;
      if (rumor.kind !== kinds.PrivateDirectMessage || !getConversationParticipants(rumor).includes(owner.pubkey))
        return;
      return storeMessage(rumor, owner.pubkey, messages);
    } catch {
      // Invalid envelopes must not interrupt the rest of the inbox.
      return;
    }
  }

  async function loadHistory() {
    const owner = await getAccount();
    const messages = new DmMemoryStore();
    const relays = await getInboxRelays(owner.pubkey);
    const gifts = await queryThroughStore(
      config,
      relays,
      [{ kinds: [kinds.GiftWrap], "#p": [owner.pubkey] }],
      Number.MAX_SAFE_INTEGER,
    );
    for (const gift of gifts) {
      await readMessage(gift, owner, messages);
    }

    if (!(await isCurrentAccount(owner))) throw new Error("Account changed");
    return messages;
  }

  const adapter: DmAdapter = {
    status: async () => {
      const account = await firstValueFrom(kehtoAccount$(config));
      return {
        available: !!account?.signer.nip44,
        ownerPubkey: account?.pubkey,
        implementations: ["nip17"],
        capabilities: ["send", "history", "subscribe"],
      };
    },
    conversations: async (query) => {
      const history = await loadHistory();
      return history.conversations(query);
    },
    messages: async (query) => {
      const history = await loadHistory();
      return history.messages(query);
    },
    send: async (request) => {
      const windowId = config.getWindowId?.();
      const owner = await getAccount();
      if (!request.recipients.length || request.recipients.some((key) => !/^[0-9a-f]{64}$/.test(key)))
        throw new Error("Invalid recipients");

      const template = await WrappedMessageFactory.create(request.recipients, request.content).as(owner.signer).stamp();
      const rumor = { ...template, id: getEventHash(template) };
      const messages = new DmMemoryStore();
      const message = storeMessage(rumor as Rumor, owner.pubkey, messages);
      if (request.conversationId && request.conversationId !== message.conversationId)
        throw new Error("Conversation does not match recipients");

      if (config.approve && !(await config.approve({ windowId, template: rumor }))) throw new Error("User denied");
      if (!(await isCurrentAccount(owner))) throw new Error("Account changed");

      const recipients = new Set([...request.recipients, owner.pubkey]);
      // Prepare every envelope before publishing, so a signing rejection sends nothing.
      const gifts = [];
      for (const recipient of recipients) {
        const gift = await GiftWrapFactory.create(owner.signer, recipient, rumor as Rumor);
        gifts.push({ gift, relays: await getInboxRelays(recipient) });
      }
      if (!(await isCurrentAccount(owner))) throw new Error("Account changed");
      for (const { gift, relays } of gifts) {
        await publishThroughStore(config, relays, gift);
      }

      return { ok: true, message };
    },
    subscribe: async (request, onMessage) => {
      const owner = await getAccount();
      const subscriptionId = `dm-${++nextSubscriptionId}`;
      const messages = new DmMemoryStore();
      const seen = new Set<string>();
      const subscription = new Subscription();
      subscriptions.set(subscriptionId, subscription);

      subscription.add(
        subscribeThroughStore(config, await getInboxRelays(owner.pubkey), [
          { kinds: [kinds.GiftWrap], "#p": [owner.pubkey] },
        ])
          .pipe(
            finalize(() => {
              subscriptions.delete(subscriptionId);
              subscription.unsubscribe();
            }),
            takeUntil(
              kehtoAccount$(config).pipe(
                filter((account) => account?.signer !== owner.signer || account.pubkey !== owner.pubkey),
              ),
            ),
          )
          .subscribe((gift) => {
            if (gift === "EOSE") return;
            void readMessage(gift, owner, messages).then(async (message) => {
              if (!message || subscription.closed || seen.has(message.id) || !(await isCurrentAccount(owner))) return;
              if (request.conversationId && message.conversationId !== request.conversationId) return;
              seen.add(message.id);
              onMessage(message);
            });
          }),
      );
      return { subscriptionId };
    },
    unsubscribe: (id) => {
      subscriptions.get(id)?.unsubscribe();
      subscriptions.delete(id);
      return { ok: true };
    },
    close: () => {
      for (const subscription of subscriptions.values()) {
        subscription.unsubscribe();
      }
      subscriptions.clear();
    },
  };
  return { adapter };
}
