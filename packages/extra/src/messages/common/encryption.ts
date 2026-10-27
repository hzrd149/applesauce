import { logger } from "applesauce-core";
import {
  isEncryptedContentFromCache,
  restoreEncryptedContent,
  saveEncryptedContent,
  type EncryptedContentCache,
  type NostrEvent,
} from "applesauce-core/helpers";

const log = logger.extend("MessagesEncryptionCache");

/** Restores event plaintext without letting unavailable storage prevent decryption */
export async function restoreMessageContent(event: NostrEvent, cache?: EncryptedContentCache): Promise<void> {
  if (!cache) return;

  try {
    await restoreEncryptedContent(event, cache);
  } catch (error) {
    log("Failed to restore encrypted content for %s", event.id, error);
  }
}

/** Persists event plaintext without letting unavailable storage prevent message delivery */
export async function saveMessageContent(event: NostrEvent, cache?: EncryptedContentCache): Promise<void> {
  if (!cache || isEncryptedContentFromCache(event)) return;

  try {
    await saveEncryptedContent(event, cache);
  } catch (error) {
    log("Failed to persist encrypted content for %s", event.id, error);
  }
}
