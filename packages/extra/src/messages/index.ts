export { LegacyMessagesClient } from "./legacy/client.js";
export { LegacyConversation } from "./legacy/conversation.js";
export { WrappedMessagesClient } from "./wrapped/client.js";
export { WrappedConversation, type WrappedConversationSendRequest } from "./wrapped/conversation.js";
export { ConversationMessagesModel, ConversationThreadsModel, ConversationRepliesModel } from "./wrapped/models.js";
export { WrappedMessagePublicationError } from "./wrapped/publication.js";
export type {
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
} from "./wrapped/types.js";
export type {
  MessageStorage,
  MessageDraft,
  MessageOperationOptions,
  MessageClientError,
  MessagesRelayStatus,
} from "./common/types.js";
export type { MessageAuthRequest, MessageAuthenticationResult } from "./common/authentication.js";
