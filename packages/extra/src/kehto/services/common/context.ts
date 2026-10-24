import { getOutboxes, kinds, normalizeToPubkey } from "applesauce-core/helpers";
import { createAccountExecutor } from "../../foundation/operation.js";
import { createActionExecutor } from "../../foundation/actions.js";
import { configured$, settle } from "../../helpers.js";
import type { KehtoCommonOptions } from "../common.js";

/** Parses a hex pubkey, npub or nprofile into a hex pubkey */
export function toPubkey(target: string) {
  const pubkey = normalizeToPubkey(target);
  if (!pubkey) throw new Error("invalid pubkey");
  return pubkey;
}

/** The dependencies available to compose common services */
export type CommonContext = ReturnType<typeof createCommonContext>;

/** Creates loaders and guarded executors for common service factories */
export function createCommonContext(config: KehtoCommonOptions) {
  const { eventStore } = config;
  const timeout = config.timeout ?? 4000;
  const withAccount = createAccountExecutor(config);
  const runAction = createActionExecutor({ ...config, withAccount, writeRelays });

  async function writeRelays(pubkey: string) {
    const mailboxes = await settle(eventStore.replaceable(kinds.RelayList, pubkey), undefined, timeout);
    const outboxes = mailboxes ? getOutboxes(mailboxes) : [];
    return outboxes.length ? outboxes : settle(configured$(config.fallbackRelays, []), [], timeout);
  }

  async function loadEvent(id: string) {
    const event = await settle(eventStore.event(id), undefined, timeout);
    if (!event) throw new Error("event not found");
    return event;
  }

  return { timeout, eventStore, withAccount, runAction, writeRelays, loadEvent };
}
