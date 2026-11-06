export { LegacyMessagesClient } from "./legacy/client.js";
export { LegacyConversation } from "./legacy/conversation.js";
export { LegacyMessageDecryptor, type LegacyMessageDecryptorOptions } from "./legacy/decryptor.js";
export { LegacyInboxReceiver } from "./legacy/inbox-receiver.js";
export { LegacyConversationReceiver, type LegacyConversationReceiverOptions } from "./legacy/conversation-receiver.js";
export { WrappedMessagesClient } from "./wrapped/client.js";
export { WrappedConversation, type WrappedConversationSendRequest } from "./wrapped/conversation.js";
export { WrappedMessagePublicationError } from "./wrapped/session.js";
export { MemoryConversationIndexStore } from "./common/conversation-index.js";
export { IndexedDBConversationIndexStore } from "./common/indexed-db-conversation-index.js";
export type {
  LegacyConversationSummary,
  LegacyDecryptionState,
  LegacyPublicationState,
  LegacyPublicationReference,
  LegacyMessagesClientOptions,
  LegacyMessageSendRequest,
  LegacyMessageAvailability,
  PreparedLegacyMessage,
  LegacyMessageHistoryOptions,
  LegacyMessagesSyncStatus,
  LegacyMailboxError,
  LegacyInboxReceiverOptions,
  LegacyMessageFailure,
  LegacyMessageFailureCode,
  LegacyReadResult,
  LegacyReceiverError,
} from "./legacy/types.js";
export type {
  WrappedMessagesClientOptions,
  WrappedMessageSendRequest,
  WrappedMessageAvailability,
  WrappedMessageRecipientSupport,
  PreparedWrappedMessage,
  WrappedMessageHistoryOptions,
  WrappedMessagesSyncStatus,
  WrappedMessagePublicationResult,
  WrappedConversationSummary,
} from "./wrapped/types.js";
export type {
  MessageStorage,
  MessageFileStorage,
  MessageDraft,
  MessageOperationOptions,
  MessageClientError,
  MessagesRelayStatus,
  ConversationIndexEntry,
  ConversationIndexListOptions,
  ConversationIndexStore,
  ConversationListOptions,
  ConversationIndexingOptions,
} from "./common/types.js";
export type { MessageAuthRequest, MessageAuthenticationResult } from "./common/authentication.js";
export {
  loadAttachment,
  uploadEncryptedFile,
  type LoadAttachmentOptions,
  type MessageFileUploader,
  type UploadedFile,
  type UploadEncryptedFileOptions,
} from "./common/attachments.js";
