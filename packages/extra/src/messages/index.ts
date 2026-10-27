export { LegacyMessagesClient } from "./legacy/client.js";
export { LegacyConversation } from "./legacy/conversation.js";
export { WrappedMessagesClient } from "./wrapped/client.js";
export { WrappedMessagePublicationError } from "./wrapped/publication.js";
export type {
  LegacyMessagesClientOptions,
  LegacyMessageSendRequest,
  LegacyMessageAvailability,
  PreparedLegacyMessage,
  LegacyMessageHistoryOptions,
  LegacyMessagesSyncStatus,
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
export type { MessageOperationOptions, MessageClientError, MessagesRelayStatus } from "./common/types.js";
export type { MessageAuthRequest } from "./common/authentication.js";
