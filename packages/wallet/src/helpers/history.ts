import {
  getHiddenTags,
  hasHiddenTags,
  HiddenContentSigner,
  isETag,
  isHiddenTagsUnlocked,
  lockHiddenTags,
  notifyEventUpdate,
  setHiddenTagsEncryptionMethod,
  UnlockedHiddenTags,
  unlockHiddenTags,
} from "applesauce-core/helpers";
import { KnownEvent, NostrEvent } from "applesauce-core/helpers/event";

export const WALLET_HISTORY_KIND = 7376;

/** Validated wallet history event */
export type WalletHistoryEvent = KnownEvent<typeof WALLET_HISTORY_KIND>;

/** Checks if an event is a valid wallet history event */
export function isValidWalletHistory(event: NostrEvent): event is WalletHistoryEvent {
  return event.kind === WALLET_HISTORY_KIND && hasHiddenTags(event);
}

// Enable hidden content for wallet history kind
setHiddenTagsEncryptionMethod(WALLET_HISTORY_KIND, "nip44");

export type HistoryDirection = "in" | "out";

export type HistoryContent = {
  /** The direction of the transaction, in = received, out = sent */
  direction: HistoryDirection;
  /** The amount of the transaction */
  amount: number;
  /** An array of token event ids created */
  created: string[];
  /** The mint that was spent from */
  mint?: string;
  /** The fee paid */
  fee?: number;
};

export const HistoryContentSymbol = Symbol.for("history-content");

/** Type for unlocked history events */
export type UnlockedHistoryContent = UnlockedHiddenTags & {
  [HistoryContentSymbol]: HistoryContent;
};

/** returns an array of redeemed event ids in a history event */
export function getHistoryRedeemed(history: NostrEvent): string[] {
  return history.tags.filter((t) => isETag(t) && t[3] === "redeemed").map((t) => t[1]);
}

/** Checks if the history contents are locked */
export function isHistoryContentUnlocked<T extends NostrEvent>(history: T): history is T & UnlockedHistoryContent {
  return isHiddenTagsUnlocked(history) && Reflect.has(history, HistoryContentSymbol) === true;
}

/** Returns the parsed content of a 7376 history event */
export function getHistoryContent<T extends UnlockedHiddenTags>(history: T): HistoryContent;
export function getHistoryContent<T extends NostrEvent>(history: T): HistoryContent | undefined;
export function getHistoryContent<T extends NostrEvent>(history: T): HistoryContent | undefined {
  // Return cached value if it exists
  if (isHistoryContentUnlocked(history)) return history[HistoryContentSymbol];

  // Get hidden tags
  const tags = getHiddenTags(history);
  if (!tags) return;

  // Read tags
  const direction = tags.find((t) => t[0] === "direction")?.[1] as HistoryDirection | undefined;
  if (!direction) throw new Error("History event missing direction");
  const amountStr = tags.find((t) => t[0] === "amount")?.[1];
  if (!amountStr) throw new Error("History event missing amount");
  const amount = parseInt(amountStr);
  if (!Number.isFinite(amount)) throw new Error("Failed to parse amount");

  const mint = tags.find((t) => t[0] === "mint")?.[1];
  const feeStr = tags.find((t) => t[0] === "fee")?.[1];
  const fee = feeStr ? parseInt(feeStr) : undefined;

  const created = tags.filter((t) => isETag(t) && t[3] === "created").map((t) => t[1]);

  const content = { direction, amount, created, mint, fee };

  // Set the cached value
  Reflect.set(history, HistoryContentSymbol, content);

  return content;
}

/** Decrypts a wallet history event */
export async function unlockHistoryContent(history: NostrEvent, signer: HiddenContentSigner): Promise<HistoryContent> {
  // Return cached value if it exists
  if (isHistoryContentUnlocked(history)) return history[HistoryContentSymbol];

  // Unlock hidden tags if needed
  await unlockHiddenTags(history, signer);

  // Get the history content
  const content = getHistoryContent(history);
  if (!content) throw new Error("Failed to unlock history content");

  // Notify the event store
  notifyEventUpdate(history);

  return content;
}

export function lockHistoryContent(history: NostrEvent) {
  Reflect.deleteProperty(history, HistoryContentSymbol);
  lockHiddenTags(history);
}
