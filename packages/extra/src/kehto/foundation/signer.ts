import type { Signer } from "@kehto/runtime";
import { unixNow, type EventTemplate, type NostrEvent } from "applesauce-core/helpers";
import { settle } from "../helpers.js";
import type { KehtoState } from "./state.js";

/** Signs a template for a napplet after the host approves it */
export async function signForNapplet(state: KehtoState, template: EventTemplate, windowId?: string) {
  const signer = state.getSigner();
  if (!signer) throw new Error("No signer configured");
  // Kehto may pass a full event, so only keep the template fields
  const { kind, tags, content, created_at } = template;
  if (state.ctx.approve && !(await state.ctx.approve({ windowId, template: { kind, tags, content, created_at } })))
    throw new Error("User denied");
  // Kehto rejects events older than 30 seconds, so stamp after the approval prompt
  return signer.signEvent({ kind, tags, content, created_at: unixNow() }) as Promise<NostrEvent>;
}

/** Creates the kehto runtime {@link Signer} for a napplet window from the current applesauce signer */
export function createKehtoSigner(state: KehtoState, windowId?: string): Signer | null {
  const signer = state.getSigner();
  if (!signer) return null;

  return {
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (template) => signForNapplet(state, template, windowId),
    getRelays: async () => {
      const user = state.getUser();
      const mailboxes = user ? await settle(user.mailboxes$, undefined, state.timeout) : undefined;
      const relays: Record<string, { read: boolean; write: boolean }> = {};
      for (const url of mailboxes?.inboxes ?? []) (relays[url] ??= { read: false, write: false }).read = true;
      for (const url of mailboxes?.outboxes ?? []) (relays[url] ??= { read: false, write: false }).write = true;
      return relays;
    },
    nip04: signer.nip04,
    nip44: signer.nip44,
  };
}
