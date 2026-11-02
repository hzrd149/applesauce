import { AppKeys, type DeviceEntry } from "nostr-double-ratchet";
import {
  BehaviorSubject,
  combineLatest,
  distinctUntilChanged,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  switchMap,
  timer,
} from "rxjs";
import { ConversationDraftState } from "../common/drafts.js";
import type { MessageDraft } from "../common/types.js";
import type { NdrMessagesClient } from "./client.js";
import type { NdrMessage, NdrSendRequest } from "./types.js";

const TYPING_THROTTLE = 3000;

/** Observes whether a typing deadline in milliseconds is still in the future */
export function typingUntil$(deadline$: Observable<number | undefined>): Observable<boolean> {
  return deadline$.pipe(
    distinctUntilChanged(),
    switchMap((deadline) => {
      const remaining = (deadline ?? 0) - Date.now();
      if (remaining <= 0) return of(false);
      return timer(remaining).pipe(
        map(() => false),
        startWith(true),
      );
    }),
    distinctUntilChanged(),
  );
}

/** A direct double-ratchet conversation with one peer owner */
export class NdrConversation {
  /** The conversation ID, which is the peer's owner pubkey */
  readonly id: string;

  private readonly drafts: ConversationDraftState;
  private lastTyping = 0;
  private readonly sending = new BehaviorSubject(0);

  /** The current draft, restored from encrypted storage on subscription */
  readonly draft$: Observable<Readonly<MessageDraft> | undefined>;
  /** Chat messages newest first, with reactions and receipts applied */
  readonly messages$: Observable<NdrMessage[]>;
  /** The newest message */
  readonly lastMessage$: Observable<NdrMessage | undefined>;
  /** Whether the peer is typing */
  readonly typing$: Observable<boolean>;
  /** The disappearing-message TTL in seconds, or null when messages are kept */
  readonly ttl$: Observable<number | null>;
  /** The peer's registered devices from their app keys, undefined until found */
  readonly peerDevices$: Observable<DeviceEntry[] | undefined>;
  /** Whether this device and the peer can exchange messages */
  readonly canSend$: Observable<boolean>;
  /** Whether a send is in progress */
  readonly sending$ = this.sending.pipe(
    map((count) => count > 0),
    distinctUntilChanged(),
  );

  constructor(
    /** The client that owns this conversation */
    readonly client: NdrMessagesClient,
    /** The peer's owner pubkey */
    readonly peer: string,
  ) {
    this.id = peer;
    this.drafts = new ConversationDraftState(`draft:${peer}`, client.draftStorage());
    this.draft$ = this.drafts.draft$;

    const history = client.history;
    this.messages$ = history.changes$.pipe(
      map(() => history.messages(peer)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.lastMessage$ = this.messages$.pipe(
      map((messages) => messages[0]),
      distinctUntilChanged(),
    );
    this.ttl$ = history.changes$.pipe(
      map(() => history.ttl(peer)),
      distinctUntilChanged(),
    );
    this.typing$ = typingUntil$(client.typingDeadlines$.pipe(map((deadlines) => deadlines.get(peer))));

    // AppKeys.fromUser follows the peer's roster through the transport's cached and live relay events.
    this.peerDevices$ = new Observable<DeviceEntry[] | undefined>((subscriber) => {
      subscriber.next(undefined);
      return AppKeys.fromUser(peer, client.transport.nostrSubscribe, (appKeys) => {
        subscriber.next(appKeys.getAllDevices());
      });
    }).pipe(shareReplay({ bufferSize: 1, refCount: true }));

    this.canSend$ = combineLatest([client.state$, this.peerDevices$]).pipe(
      map(([state, devices]) => state.canSendPrivateMessages && !!devices?.length),
      distinctUntilChanged(),
    );
  }

  private async track<T>(work: () => Promise<T>): Promise<T> {
    this.sending.next(this.sending.value + 1);
    try {
      return await work();
    } finally {
      this.sending.next(this.sending.value - 1);
    }
  }

  /**
   * Restores the saved draft
   * @throws if storage fails or the saved draft is invalid
   */
  loadDraft(): Promise<Readonly<MessageDraft> | undefined> {
    return this.drafts.load();
  }

  /**
   * Saves the draft before notifying subscribers
   * @throws if the draft is invalid or storage fails
   */
  setDraft(draft: MessageDraft): Promise<void> {
    return this.drafts.set(draft);
  }

  /**
   * Removes the saved draft
   * @throws if storage fails
   */
  clearDraft(): Promise<void> {
    return this.drafts.clear();
  }

  /**
   * Encrypts and queues a message for every peer and sibling device, then stores it as queued
   * @throws if the message is empty or the runtime cannot send
   */
  async send(request: NdrSendRequest): Promise<NdrMessage | undefined> {
    const content = request.content.trim();
    if (!content) throw new Error("Message is empty");

    return this.track(async () => {
      const tags = request.replyTo ? [["e", request.replyTo]] : [];
      const rumor = await this.client.runtime.sendMessage(this.peer, content, { tags });

      await this.client.storeSent(this.id, rumor, request.replyTo);
      return this.client.history.messages(this.id).find((message) => message.id === rumor.id);
    });
  }

  /**
   * Sends the current draft and removes it only if it was not edited meanwhile
   * @throws if there is no draft or sending fails
   */
  async sendDraft(): Promise<void> {
    const draft = await this.drafts.load();
    if (!draft?.content.trim()) throw new Error("Message is empty");

    await this.send({ content: draft.content, replyTo: draft.replyTo });
    await this.drafts.clearIfCurrent(draft, new AbortController().signal);
  }

  /**
   * Sends a reaction to a message and stores it locally
   * @throws if the runtime cannot send
   */
  async react(messageId: string, content: string): Promise<void> {
    const rumor = await this.client.runtime.sendMessage(this.peer, content, { kind: 7, tags: [["e", messageId]] });
    await this.client.history.addReaction(this.id, {
      id: rumor.id,
      target: messageId,
      content,
      sender: this.client.pubkey,
    });
  }

  /**
   * Marks incoming messages as read and sends a seen receipt for those not yet seen
   * @throws if storage or the runtime fails
   */
  async markSeen(): Promise<void> {
    const history = this.client.history;
    const lastRead = history.lastRead(this.id);
    const unseen = history
      .messages(this.id)
      .filter((message) => message.delivery === "received" && message.createdAt > lastRead);
    if (!unseen.length) return;

    await history.markRead(this.id, unseen[0].createdAt);
    await this.client.runtime.sendReceipt(
      this.peer,
      "seen",
      unseen.map((message) => message.id),
    );
  }

  /** Tells the peer this user is typing, at most once every few seconds */
  sendTyping(): void {
    const now = Date.now();
    if (now - this.lastTyping < TYPING_THROTTLE) return;
    this.lastTyping = now;

    this.client.runtime.sendTyping(this.peer).catch((error) => this.client.report("publish", error));
  }

  /**
   * Sets the disappearing-message TTL for both sides, or disables it with null
   * @throws if the runtime or storage fails
   */
  async setTtl(ttl: number | null): Promise<void> {
    await this.client.runtime.setChatSettingsForPeer(this.peer, ttl);
    await this.client.history.setTtl(this.peer, ttl);
  }

  /**
   * Deletes the sessions with the peer and this conversation's local history
   * @throws if the runtime or storage fails
   */
  async delete(): Promise<void> {
    await this.client.runtime.deleteChat(this.peer);
    await this.client.history.clearConversation(this.id);
    await this.drafts.clear();
  }

  /** Releases local state without deleting stored history */
  dispose(): void {
    this.drafts.dispose();
    this.sending.complete();
  }
}
