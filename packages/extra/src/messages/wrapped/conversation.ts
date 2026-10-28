import {
  createConversationIdentifier,
  getConversationIdentifierFromMessage,
  getConversationParticipants,
} from "applesauce-common/helpers";
import { RumorStore } from "applesauce-core/event-store";
import { kinds, type Rumor } from "applesauce-core/helpers";
import type { Observable, Subscription } from "rxjs";
import type { MessageOperationOptions } from "../common/types.js";
import type { WrappedMessagesClient } from "./client.js";
import { ConversationMessagesModel, ConversationRepliesModel, ConversationThreadsModel } from "./models.js";
import type { PreparedWrappedMessage, WrappedMessageSendRequest } from "./types.js";

/** A message request whose recipients are supplied by its conversation */
export type WrappedConversationSendRequest = Omit<WrappedMessageSendRequest, "recipients">;

/** A local NIP-17 conversation over decrypted rumors owned by one client */
export class WrappedConversation {
  /** The canonical conversation identifier */
  readonly id: string;
  /** The canonical participant set including the client owner */
  readonly participants: readonly string[];
  /** The local decrypted rumor store, without network loaders */
  readonly eventStore = new RumorStore();
  /** The conversation's kind-14 timeline */
  readonly messages$ = this.eventStore.model(ConversationMessagesModel);
  /** The root messages that have replies */
  readonly threads$ = this.eventStore.model(ConversationThreadsModel);
  private readonly subscription: Subscription;
  private readonly cancellation = new AbortController();

  /** Creates a local conversation and follows its owner's decrypted messages */
  constructor(
    /** The fixed-account owner of this conversation */
    readonly client: WrappedMessagesClient,
    participants: string | string[],
  ) {
    this.id = createConversationIdentifier(client.pubkey, getConversationParticipants(participants));
    this.participants = Object.freeze(getConversationParticipants(this.id));
    this.subscription = client.conversation$(this.id).subscribe((messages) => {
      const ids = new Set(messages.map((message) => message.id));
      for (const previous of this.eventStore.getByFilters({})) {
        if (!ids.has(previous.id)) this.eventStore.remove(previous);
      }
      for (const message of messages) this.eventStore.add(message);
    });
  }

  /** Whether this conversation has been permanently released */
  get isDisposed(): boolean {
    return this.cancellation.signal.aborted;
  }

  private context(options: MessageOperationOptions) {
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.cancellation.signal])
      : this.cancellation.signal;
    signal.throwIfAborted();
    return { ...options, signal };
  }

  /** Returns direct replies to a message ID or rumor */
  replies$(message: string | Rumor): Observable<Rumor[]> {
    return this.eventStore.model(ConversationRepliesModel, typeof message === "string" ? message : message.id);
  }

  /**
   * Prepares encrypted envelopes for this conversation's participants
   * @throws if disposed or envelope preparation fails
   */
  async prepareSend(
    request: WrappedConversationSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<PreparedWrappedMessage> {
    const prepared = await this.client.prepareSend(
      { ...request, recipients: this.participants },
      this.context(options),
    );
    return {
      message: prepared.message,
      get publications() {
        return prepared.publications;
      },
      publish: async (publishOptions = {}) => prepared.publish(this.context(publishOptions)),
    };
  }

  /**
   * Sends a message to this conversation's participants
   * @throws if disposed, preparation fails, or publication fails
   */
  async send(request: WrappedConversationSendRequest, options: MessageOperationOptions = {}): Promise<Rumor> {
    return (await this.prepareSend(request, options)).publish(options);
  }

  /**
   * Replies to a message in this conversation
   * @throws if the parent belongs to another conversation or sending fails
   */
  async reply(
    parent: Rumor,
    request: Omit<WrappedConversationSendRequest, "replyTo">,
    options: MessageOperationOptions = {},
  ): Promise<Rumor> {
    if (parent.kind !== kinds.PrivateDirectMessage || getConversationIdentifierFromMessage(parent) !== this.id)
      throw new Error("Reply parent does not belong to this conversation");
    return this.send({ ...request, replyTo: parent.id }, options);
  }

  /** Releases local subscriptions, pending sends, and retained plaintext */
  dispose(): void {
    if (this.isDisposed) return;
    this.cancellation.abort();
    this.subscription.unsubscribe();
    this.eventStore.dispose();
    for (const message of [...this.eventStore.getByFilters({})]) this.eventStore.remove(message);
  }

  /** Releases this conversation when leaving a using scope */
  [Symbol.dispose](): void {
    this.dispose();
  }
}
