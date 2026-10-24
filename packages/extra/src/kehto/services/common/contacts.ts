import type { CommonServiceOptions } from "@kehto/services";
import { type CommonContext, toPubkey } from "./context.js";
import { ContactsFactory } from "applesauce-common/factories";
import { getContacts, kinds } from "applesauce-core/helpers";
import type { ISigner } from "applesauce-signers";
import { errorMessage, settle } from "../../helpers.js";

/** Creates contact lookups and serialized follow updates */
export function createContactsService({
  timeout,
  eventStore,
  withAccount,
  runAction,
}: Pick<CommonContext, "timeout" | "eventStore" | "withAccount" | "runAction">): Pick<
  CommonServiceOptions,
  "follows" | "follow" | "unfollow"
> {
  const contactsQueues = new Map<string, Promise<void>>();

  function modifyContacts(pubkeys: string[], windowId: string, remove: boolean) {
    // Validate the whole batch before any signing or publishing.
    let contacts: string[];
    try {
      contacts = [...new Set(pubkeys.map(toPubkey))];
    } catch (err) {
      return Promise.resolve({ ok: false, error: errorMessage(err) });
    }

    return runAction(windowId, async ({ account, signer, publish, signal }) => {
      const previous = contactsQueues.get(account.pubkey) ?? Promise.resolve();
      const update = previous.then(async () => {
        signal.throwIfAborted();
        if (!contacts.length) return;
        const existing = await settle(eventStore.replaceable(kinds.Contacts, account.pubkey), undefined, timeout);
        signal.throwIfAborted();
        let factory = existing ? ContactsFactory.modify(existing) : ContactsFactory.create();
        for (const pubkey of contacts) {
          factory = remove ? factory.removeContact(pubkey) : factory.addContact(pubkey);
        }

        // Replaceable events must advance beyond the previous event, even in the same second.
        const contactsSigner: ISigner = {
          ...signer,
          signEvent: (template) =>
            signer.signEvent({
              ...template,
              created_at: Math.max(template.created_at, (existing?.created_at ?? 0) + 1),
            }),
        };
        signal.throwIfAborted();
        await publish(await factory.sign(contactsSigner));
      });
      // Release the queue on cancellation even when an external signer or relay promise never settles.
      let release!: () => void;
      const cancelled = new Promise<void>((resolve) => {
        release = resolve;
      });
      signal.addEventListener("abort", release, { once: true });
      const settled = Promise.race([update.catch(() => {}), cancelled]);
      contactsQueues.set(account.pubkey, settled);
      try {
        await Promise.race([update, cancelled]);
        signal.throwIfAborted();
      } finally {
        signal.removeEventListener("abort", release);
        if (contactsQueues.get(account.pubkey) === settled) contactsQueues.delete(account.pubkey);
      }
    });
  }

  return {
    follows: async () => {
      try {
        return await withAccount(async ({ account, signal }) => {
          const contacts = await settle(eventStore.replaceable(kinds.Contacts, account.pubkey), undefined, timeout);
          signal.throwIfAborted();
          return { ok: true, pubkeys: contacts ? getContacts(contacts).map((contact) => contact.pubkey) : [] };
        });
      } catch (err) {
        return { ok: false, pubkeys: [], error: errorMessage(err) };
      }
    },
    follow: (pubkeys, { windowId }) => modifyContacts(pubkeys, windowId, false),
    unfollow: (pubkeys, { windowId }) => modifyContacts(pubkeys, windowId, true),
  };
}
