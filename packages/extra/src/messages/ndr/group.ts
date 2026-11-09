import { getEventHash, unixNow } from "applesauce-core/helpers";
import {
  addGroupMember,
  buildGroupRosterFactEvent,
  CHAT_MESSAGE_KIND,
  isGroupAdmin,
  REACTION_KIND,
  removeGroupMember,
  updateGroupData,
  type GroupData,
  type Rumor,
} from "nostr-double-ratchet";
import { BehaviorSubject, combineLatest, distinctUntilChanged, map, Observable, shareReplay } from "rxjs";
import type { FileMetadataFields } from "applesauce-common/helpers/file-metadata";
import type { UploadEncryptedFileOptions } from "../common/attachments.js";
import { ConversationDraftState } from "../common/drafts.js";
import { buildNdrChatMessage } from "./message.js";
import type { MessageDraft } from "../common/types.js";
import type { NdrMessagesClient } from "./client.js";
import { getNdrGroupConversationId } from "./history.js";
import type { NdrGroupRecord, NdrMessage, NdrSendRequest } from "./types.js";

/** A double-ratchet group conversation, delivered with sender keys over pairwise sessions */
export class NdrGroupConversation {
  /** The conversation ID, `group:<id>` */
  readonly id: string;

  private readonly drafts: ConversationDraftState;
  private readonly sending = new BehaviorSubject(0);

  /** The stored group roster, undefined once the group is left */
  readonly group$: Observable<NdrGroupRecord | undefined>;
  /** Whether the group is an invitation that has not been accepted */
  readonly pending$: Observable<boolean>;
  /** Whether the current account administers the group */
  readonly admin$: Observable<boolean>;
  /** Whether this device can send to the group, which needs a joined, accepted membership */
  readonly canSend$: Observable<boolean>;
  /** The current draft, restored from encrypted storage on subscription */
  readonly draft$: Observable<Readonly<MessageDraft> | undefined>;
  /** Chat messages newest first, with reactions applied */
  readonly messages$: Observable<NdrMessage[]>;
  /** The newest message */
  readonly lastMessage$: Observable<NdrMessage | undefined>;
  /** Whether a send is in progress */
  readonly sending$ = this.sending.pipe(
    map((count) => count > 0),
    distinctUntilChanged(),
  );

  constructor(
    /** The client that owns this group */
    readonly client: NdrMessagesClient,
    /** The group ID */
    readonly groupId: string,
  ) {
    this.id = getNdrGroupConversationId(groupId);
    this.drafts = new ConversationDraftState(`draft:${this.id}`, client.draftStorage(), client.draftFileStorage());
    this.draft$ = this.drafts.draft$;

    const history = client.history;
    this.group$ = history.changes$.pipe(
      map(() => history.group(groupId)),
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.pending$ = this.group$.pipe(
      map((record) => record?.data.accepted === false),
      distinctUntilChanged(),
    );
    this.admin$ = this.group$.pipe(
      map((record) => !!record && this.isAdmin(record)),
      distinctUntilChanged(),
    );
    this.canSend$ = combineLatest([client.state$, this.group$]).pipe(
      map(([state, record]) => {
        if (!record || record.removed || record.data.accepted === false) return false;
        return state.canSendPrivateMessages;
      }),
      distinctUntilChanged(),
    );

    this.messages$ = history.changes$.pipe(
      map(() => history.messages(this.id)),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
    this.lastMessage$ = this.messages$.pipe(
      map((messages) => messages[0]),
      distinctUntilChanged(),
    );
  }

  private record(): NdrGroupRecord {
    const record = this.client.history.group(this.groupId);
    if (!record || record.removed) throw new Error("Not a member of this group");
    return record;
  }

  /** Whether the current account administers the group */
  isAdmin(record: NdrGroupRecord): boolean {
    return isGroupAdmin(record.data, this.client.pubkey);
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
   * Saves the draft before notifying subscribers
   * @throws if the draft is invalid or storage fails
   */
  setDraft(draft: MessageDraft): Promise<void> {
    return this.drafts.set(draft);
  }

  /**
   * Encrypts a message with this device's sender key, publishes it, and stores it as queued
   * @throws if the message has no text or attachments, the group is unknown, or sending fails
   */
  async send(request: NdrSendRequest): Promise<NdrMessage | undefined> {
    const { content, tags } = await buildNdrChatMessage({ ...request, emojis: request.emojis ?? this.client.emojis });
    this.record();

    return this.track(async () => {
      const { inner } = await this.client.runtime.sendGroupEvent(this.groupId, {
        kind: CHAT_MESSAGE_KIND,
        content,
        tags,
      });
      await this.client.storeSent(this.id, inner);
      return this.client.history.messages(this.id).find((message) => message.id === inner.id);
    });
  }

  /**
   * Encrypts a file and uploads the ciphertext, returning the attachment to {@link send}
   * @throws if no uploader is configured or the upload fails
   */
  uploadFile(file: Blob, options?: UploadEncryptedFileOptions): Promise<FileMetadataFields> {
    return this.client.uploadFile(file, options);
  }

  /**
   * Sends the current draft with optional uploaded attachments and removes the draft only if it was not edited meanwhile
   * @throws if there is no text or attachments, or sending fails
   */
  async sendDraft(attachments: FileMetadataFields[] = []): Promise<void> {
    const draft = await this.drafts.load();

    await this.send({ content: draft?.content ?? "", replyTo: draft?.replyTo, attachments });
    if (draft) await this.drafts.clearIfCurrent(draft, new AbortController().signal);
  }

  /**
   * Sends a reaction to a group message and stores it locally
   * @throws if the group is unknown or sending fails
   */
  async react(messageId: string, content: string): Promise<void> {
    this.record();
    const { inner } = await this.client.runtime.sendGroupEvent(this.groupId, {
      kind: REACTION_KIND,
      content,
      tags: [["e", messageId]],
    });

    await this.client.history.addReaction(this.id, {
      id: inner.id,
      target: messageId,
      content,
      sender: this.client.pubkey,
    });
  }

  /**
   * Marks the group's messages as read locally
   * @throws if storage fails
   */
  async markSeen(): Promise<void> {
    const [latest] = this.client.history.messages(this.id);
    if (latest) await this.client.history.markRead(this.id, latest.createdAt);
  }

  /**
   * Accepts a group invitation so it appears as a joined group
   * @throws if the group is unknown or storage fails
   */
  async accept(): Promise<void> {
    const record = this.record();
    const data = { ...record.data, accepted: true };

    await this.client.runtime.upsertGroup(data);
    await this.client.history.putGroup({ ...record, data });
  }

  /**
   * Leaves the group locally and deletes its history
   * @throws if storage fails
   */
  async leave(): Promise<void> {
    this.client.runtime.removeGroup(this.groupId);
    await this.client.history.removeGroup(this.groupId);
    await this.drafts.clear();
  }

  /**
   * Adds a member and sends the new roster to everyone
   * @throws if the account is not an admin or sending fails
   */
  addMember(member: string): Promise<void> {
    return this.updateRoster((data) => addGroupMember(data, member, this.client.pubkey));
  }

  /**
   * Removes a member, sends the new roster to everyone including them, and rotates this device's sender key
   * @throws if the account is not an admin or sending fails
   */
  async removeMember(member: string): Promise<void> {
    await this.updateRoster((data) => removeGroupMember(data, member, this.client.pubkey));

    // A fresh sender key keeps the removed member from reading later messages.
    const manager = this.client.runtime.getGroupManager();
    await manager?.rotateSenderKey(this.groupId, {
      sendPairwise: async (recipient, rumor) => {
        await this.client.runtime.sendEvent(recipient, rumor, undefined, { includeLocalSiblings: false });
      },
    });
  }

  /**
   * Renames the group and sends the new roster to everyone
   * @throws if the account is not an admin or sending fails
   */
  rename(name: string): Promise<void> {
    return this.updateRoster((data) => updateGroupData(data, { name: name.trim() }, this.client.pubkey));
  }

  private async updateRoster(change: (data: GroupData) => GroupData | null): Promise<void> {
    const record = this.record();
    const next = change(record.data);
    if (!next) throw new Error("Only group admins can change the roster");

    const now = unixNow();
    const revision = record.revision + 1;
    const fact: Rumor = {
      ...buildGroupRosterFactEvent(
        { ...next, createdAt: Math.floor(next.createdAt / 1000) },
        {
          signerPubkey: this.client.pubkey,
          revision,
          createdBy: record.createdBy,
          updatedAt: now,
          eventCreatedAt: now,
          protocol: "sender_key_v1",
        },
      ),
      pubkey: this.client.pubkey,
      id: "",
    };

    // Removed members get the roster too, so their clients learn about the removal.
    const recipients = [...new Set([...record.data.members, ...next.members])];
    await this.track(() =>
      Promise.all(
        recipients.map(async (recipient) => {
          const rumor = { ...fact, tags: [...fact.tags, ["p", recipient]] };
          rumor.id = getEventHash(rumor);
          await this.client.runtime.sendEvent(recipient, rumor, undefined, { includeLocalSiblings: false });
        }),
      ),
    );

    await this.client.runtime.upsertGroup(next);
    await this.client.history.putGroup({ ...record, data: next, revision });
  }

  /** Releases local state without deleting stored history */
  dispose(): void {
    this.drafts.dispose();
    this.sending.complete();
  }
}
