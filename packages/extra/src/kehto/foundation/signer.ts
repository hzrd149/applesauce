import type { Signer } from "@kehto/runtime";
import { unixNow, type EventTemplate, type NostrEvent } from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";
import { settle } from "../helpers.js";
import { castUser } from "applesauce-common/casts";
import type { KehtoContext } from "../types.js";

/** Host approval and timestamp settings for napplet signing */
export interface NappletSigningOptions {
  /** The host callback that approves a signing request */
  approve?: KehtoContext["approve"];
  /** The napplet window asking to sign */
  windowId?: string;
  /** The earliest timestamp allowed for the signed event */
  minimumTimestamp?: number;
}

/**
 * Signs a template for a napplet after the host approves it
 * @throws if no signer is configured, approval is denied, or signing fails
 */
export async function signForNapplet(
  signer: ISigner | undefined,
  template: EventTemplate,
  { approve, windowId, minimumTimestamp = 0 }: NappletSigningOptions = {},
) {
  if (!signer) throw new Error("No signer configured");

  // Kehto may pass a full event, so only keep the template fields
  const { kind, tags, content, created_at } = template;
  if (approve) {
    const approved = await approve({
      windowId,
      template: { kind, tags, content, created_at },
    });
    if (!approved) throw new Error("User denied");
  }

  // Kehto rejects events older than 30 seconds, so stamp after the approval prompt
  return signer.signEvent({
    kind,
    tags,
    content,
    created_at: Math.max(unixNow(), minimumTimestamp),
  }) as Promise<NostrEvent>;
}

/** Creates an applesauce signer for actions and factories that asks the host before signing for a napplet */
export function createApprovingSigner(
  signer: ISigner | undefined,
  options: NappletSigningOptions = {},
): ISigner | undefined {
  if (!signer) return undefined;

  // Signer methods live on class prototypes, so wrap them explicitly instead of spreading
  return {
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (template) => signForNapplet(signer, template, options),
    nip04: signer.nip04,
    nip44: signer.nip44,
  };
}

/** Creates the kehto runtime {@link Signer} for a napplet window from the current applesauce signer */
export function createKehtoSigner(
  signer: ISigner | undefined,
  { eventStore, timeout = 4000, approve }: Pick<KehtoContext, "eventStore" | "timeout" | "approve">,
  windowId?: string,
): Signer | null {
  if (!signer) return null;

  return {
    getPublicKey: () => signer.getPublicKey(),
    signEvent: (template) => signForNapplet(signer, template, { approve, windowId }),
    getRelays: async () => {
      const pubkey = await signer.getPublicKey();
      const user = castUser(pubkey, eventStore);
      const mailboxes = await settle(user.mailboxes$, undefined, timeout);
      const relays: Record<string, { read: boolean; write: boolean }> = {};

      for (const url of mailboxes?.inboxes ?? []) {
        const permissions = (relays[url] ??= { read: false, write: false });
        permissions.read = true;
      }

      for (const url of mailboxes?.outboxes ?? []) {
        const permissions = (relays[url] ??= { read: false, write: false });
        permissions.write = true;
      }

      return relays;
    },
    nip04: signer.nip04,
    nip44: signer.nip44,
  };
}
