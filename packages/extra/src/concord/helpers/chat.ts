// CORD-03 Chat Plane validation helpers.

/** Validate a decoded chat rumor's channel/epoch binding (CORD-03 §3). */
export function checkChatBinding(tags: string[][], channelId: string, epoch: number): boolean {
  const ch = tags.find((t) => t[0] === "channel")?.[1];
  const ep = tags.find((t) => t[0] === "epoch")?.[1];
  return ch === channelId && ep === String(epoch);
}
