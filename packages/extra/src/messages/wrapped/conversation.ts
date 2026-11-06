import { ConversationDraftState } from "../common/drafts.js";
import {
  createConversationIdentifier,
  getConversationIdentifierFromMessage,
  getConversationParticipants,
  getWrappedMessageParent,
  isWrappedMessage,
} from "applesauce-common/helpers";
import type { FileMetadataFields } from "applesauce-common/helpers/file-metadata";
import { kinds, type Filter, type Rumor } from "applesauce-core/helpers";
import { Observable, ReplaySubject, map, shareReplay, takeUntil } from "rxjs";
import type { UploadEncryptedFileOptions } from "../common/attachments.js";
import type { MessageDraft, MessageFileStorage, MessageStorage, MessageOperationOptions } from "../common/types.js";
import type { WrappedMessagesClient } from "./client.js";
import type { PreparedWrappedMessage, WrappedMessageSendRequest } from "./types.js";

/** A message request whose recipients are supplied by its conversation */
export type WrappedConversationSendRequest = Omit<WrappedMessageSendRequest, "recipients">;

/** A local NIP-17 conversation over decrypted rumors owned by one client */
export class WrappedConversation {
  /** The canonical conversation identifier */
  readonly id: string;

  private readonly drafts: ConversationDraftState;
  /** The current plaintext draft, restored from storage on subscription */
  readonly draft$: Observable<Readonly<MessageDraft> | undefined>;

  /** The canonical participant set including the client owner */
  readonly participants: readonly string[];

  /** The shared plaintext store; conversation disposal never clears it */
  readonly rumorStore;

  /** NIP-01 candidate filter; use matches to distinguish exact participant sets */
  readonly filter: Filter;
  private readonly destroyed = new ReplaySubject<void>(1);
  private readonly cancellation = new AbortController();

  /** Creates a conversation handle without subscribing to or querying the store */
  constructor(
    /** The fixed-account owner of this conversation */
    readonly client: WrappedMessagesClient,
    participants: string | string[],
    /** The optional plaintext draft storage */
    draftStorage?: MessageStorage,
    /** The optional storage for files staged in drafts */
    draftFileStorage?: MessageFileStorage,
  ) {
    this.id = createConversationIdentifier(client.pubkey, getConversationParticipants(participants));
    this.participants = Object.freeze(getConversationParticipants(this.id));
    this.drafts = new ConversationDraftState(`draft:${this.id}`, draftStorage, draftFileStorage);
    this.draft$ = this.drafts.draft$;

    this.rumorStore = client.rumorStore;
    this.filter = {
      kinds: [kinds.PrivateDirectMessage, kinds.FileMessage],
      authors: [...this.participants],
      ...(this.participants.length > 1 ? { "#p": [...this.participants] } : {}),
    };
  }

  /** Whether this conversation has been permanently released */
  get isDisposed(): boolean {
    return this.cancellation.signal.aborted;
  }

  /**
   * Restores the saved draft without starting message loading
   * @throws if disposed, storage fails, or the saved draft is invalid
   */
  loadDraft(): Promise<Readonly<MessageDraft> | undefined> {
    return this.drafts.load();
  }

  /**
   * Saves the conversation's plaintext draft before notifying subscribers
   * @throws if disposed, the draft is invalid, or storage fails
   */
  setDraft(draft: MessageDraft): Promise<void> {
    return this.drafts.set(draft);
  }

  /**
   * Removes the conversation's saved draft before notifying subscribers
   * @throws if disposed or storage fails
   */
  clearDraft(): Promise<void> {
    return this.drafts.clear();
  }

  private context(options: MessageOperationOptions) {
    const signal = options.signal
      ? AbortSignal.any([options.signal, this.cancellation.signal])
      : this.cancellation.signal;
    signal.throwIfAborted();

    return { ...options, signal };
  }

  /** Checks whether a rumor belongs to this exact conversation */
  matches(message: Rumor): boolean {
    return isWrappedMessage(message) && getConversationIdentifierFromMessage(message) === this.id;
  }

  /** Watches direct replies using the store's NIP-01 tag query */
  replies$(message: string | Rumor, filter: Filter = {}): Observable<Rumor[]> {
    const id = typeof message === "string" ? message : message.id;
    return this.timeline$({ ...filter, "#e": [id] }).pipe(
      map((messages) => messages.filter((message) => getWrappedMessageParent(message) === id)),
    );
  }

  /**
   * Reads a store snapshot; filter limits apply to candidates before exact participant matching
   * @throws if disposed, cancelled, or the store query fails
   */
  async getMessages(filter: Filter, options: MessageOperationOptions = {}): Promise<Rumor[]> {
    const { signal } = this.context(options);
    const messages = await this.rumorStore.getTimeline({ ...this.filter, ...filter });
    signal.throwIfAborted();
    return messages.filter((message) => this.matches(message));
  }

  /** Watches a caller-selected store window; limit bounds initial candidates, not future live arrivals */
  timeline$(filter: Filter): Observable<Rumor[]> {
    return this.rumorStore.timeline({ ...this.filter, ...filter }).pipe(
      map((messages) => messages.filter((message) => this.matches(message))),
      shareReplay({ bufferSize: 1, refCount: true }),
      takeUntil(this.destroyed),
    );
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
   * Encrypts and uploads a file with the client's uploader, returning the metadata to send with {@link send}
   * @throws if disposed, no uploader is configured, or the upload fails
   */
  async uploadFile(
    file: Blob,
    options: MessageOperationOptions & UploadEncryptedFileOptions = {},
  ): Promise<FileMetadataFields> {
    return this.client.uploadFile(file, { ...options, ...this.context(options) });
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
    if (!this.matches(parent)) throw new Error("Reply parent does not belong to this conversation");
    return this.send({ ...request, replyTo: parent.id }, options);
  }

  /** Releases conversation subscriptions and drafts without clearing shared rumors */
  dispose(): void {
    if (this.isDisposed) return;

    this.cancellation.abort();
    this.drafts.dispose();
    this.destroyed.next();
    this.destroyed.complete();
  }

  /** Releases this conversation when leaving a using scope */
  [Symbol.dispose](): void {
    this.dispose();
  }
}
