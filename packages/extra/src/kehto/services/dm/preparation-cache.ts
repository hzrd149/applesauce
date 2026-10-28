import type { DmSendRequest } from "@kehto/services";

/** Retains prepared handles for Kehto's window-scoped caller retry identities */
export class DmPreparationCache<T> {
  private readonly entries = new Map<string, { request: string; preparation: Promise<T> }>();

  /**
   * Returns a retained preparation or creates one for a Kehto request
   * @throws if a caller ID is reused for another request or preparation fails
   */
  async prepare(request: DmSendRequest, windowId: string | undefined, create: () => Promise<T>): Promise<T> {
    if (!request.clientMessageId) return create();
    const key = JSON.stringify([windowId, request.clientMessageId]);
    const fingerprint = JSON.stringify([[...new Set(request.recipients)].sort(), request.content]);
    const previous = this.entries.get(key);
    if (previous) {
      if (previous.request !== fingerprint) throw new Error("DM clientMessageId belongs to another message");
      return previous.preparation;
    }

    if (this.entries.size >= 100) this.entries.delete(this.entries.keys().next().value!);
    const preparation = Promise.resolve().then(create);
    this.entries.set(key, { request: fingerprint, preparation });
    try {
      return await preparation;
    } catch (error) {
      if (this.entries.get(key)?.preparation === preparation) this.entries.delete(key);
      throw error;
    }
  }

  /** Releases prepared handles when the account session ends */
  clear(): void {
    this.entries.clear();
  }
}
