import type { ConversationDraftState } from "../common/drafts.js";
import {
  createConversationIdentifier,
  getConversationIdentifierFromMessage,
  getConversationParticipants,
  getWrappedMessageParent,
  isWrappedMessage,
} from "applesauce-common/helpers";
import type { FileMetadataFields } from "applesauce-common/helpers/file-metadata";
import { kinds, type Filter, type Rumor } from "applesauce-core/helpers";
import { Observable, map, shareReplay } from "rxjs";
import type { UploadEncryptedFileOptions } from "../common/attachments.js";
import type { MessageDraft, MessageOperationOptions } from "../common/types.js";
import type { WrappedMessagesClient } from "./client.js";
import type { PreparedWrappedMessage, WrappedMessageSendRequest } from "./types.js";

/** A message request whose recipients are supplied by its conversation */
export type WrappedConversationSendRequest = Omit<WrappedMessageSendRequest, "recipients">;

/** A local NIP-17 conversation over decrypted rumors owned by one client */
export class WrappedConversation {
  /** The canonical conversation identifier */
  readonly id: string;

  /** The current plaintext draft, restored from storage on subscription */
  readonly draft$: Observable<Readonly<MessageDraft> | undefined>;

  /** The canonical participant set including the client owner */
  readonly participants: readonly string[];

  /** The shared plaintext store owned by the receiver or application */
  readonly rumorStore;

  /** NIP-01 candidate filter; use matches to distinguish exact participant sets */
  readonly filter: Filter;

  /** Creates a conversation handle without subscribing to or querying the store */
  constructor(
    /** The fixed-account owner of this conversation */
    readonly client: WrappedMessagesClient,
    participants: string | string[],
    /** The draft state owned and disposed by the client */
    private readonly drafts: ConversationDraftState,
  ) {
    this.id = createConversationIdentifier(client.pubkey, getConversationParticipants(participants));
    this.participants = Object.freeze(getConversationParticipants(this.id));
    this.draft$ = this.drafts.draft$;

    this.rumorStore = client.rumorStore;
    this.filter = {
      kinds: [kinds.PrivateDirectMessage, kinds.FileMessage],
      authors: [...this.participants],
      ...(this.participants.length > 1 ? { "#p": [...this.participants] } : {}),
    };
  }

  /**
   * Restores the saved draft without starting message loading
   * @throws if the client is disposed, storage fails, or the saved draft is invalid
   */
  loadDraft(): Promise<Readonly<MessageDraft> | undefined> {
    return this.drafts.load();
  }

  /**
   * Saves the conversation's plaintext draft before notifying subscribers
   * @throws if the client is disposed, the draft is invalid, or storage fails
   */
  setDraft(draft: MessageDraft): Promise<void> {
    return this.drafts.set(draft);
  }

  /**
   * Removes the conversation's saved draft before notifying subscribers
   * @throws if the client is disposed or storage fails
   */
  clearDraft(): Promise<void> {
    return this.drafts.clear();
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
   * @throws if cancelled or the store query fails
   */
  async getMessages(filter: Filter, options: MessageOperationOptions = {}): Promise<Rumor[]> {
    const { signal } = options;
    signal?.throwIfAborted();
    const messages = await this.rumorStore.getTimeline({ ...this.filter, ...filter });
    signal?.throwIfAborted();
    return messages.filter((message) => this.matches(message));
  }

  /** Watches a caller-selected store window; limit bounds initial candidates, not future live arrivals */
  timeline$(filter: Filter): Observable<Rumor[]> {
    return this.rumorStore.timeline({ ...this.filter, ...filter }).pipe(
      map((messages) => messages.filter((message) => this.matches(message))),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  /**
   * Prepares encrypted envelopes for this conversation's participants
   * @throws if the client is disposed, cancelled, or envelope preparation fails
   */
  prepareSend(
    request: WrappedConversationSendRequest,
    options: MessageOperationOptions = {},
  ): Promise<PreparedWrappedMessage> {
    return this.client.prepareSend({ ...request, recipients: this.participants }, options);
  }

  /**
   * Encrypts and uploads a file with the client's uploader, returning the metadata to send with {@link send}
   * @throws if the client is disposed, no uploader is configured, or the upload fails
   */
  async uploadFile(
    file: Blob,
    options: MessageOperationOptions & UploadEncryptedFileOptions = {},
  ): Promise<FileMetadataFields> {
    return this.client.uploadFile(file, options);
  }

  /**
   * Sends a message to this conversation's participants
   * @throws if the client is disposed, preparation fails, or publication fails
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
}
