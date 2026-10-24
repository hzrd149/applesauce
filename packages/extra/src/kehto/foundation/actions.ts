import { ActionRunner } from "applesauce-actions";
import type { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import type { KehtoSignRequest } from "../types.js";
import { errorMessage } from "../helpers.js";
import type { KehtoAccount } from "./account.js";
import { createAccountExecutor } from "./operation.js";
import { publishThroughStore } from "./pool.js";
import { createApprovingSigner } from "./signer.js";

/** The guarded tools available during a social action */
export type ActionTools = {
  /** The action runner using the guarded signer and publisher */
  runner: ActionRunner;
  /** The signer guarded by the operation signal */
  signer: ISigner;
  /** The account owning the action */
  account: KehtoAccount;
  /** The signal invalidating the action */
  signal: AbortSignal;
  /** The publisher routing and saving signed events */
  publish: (event: NostrEvent, relays?: string[]) => Promise<void>;
};

/** Dependencies for approved and account-scoped actions */
export interface ActionExecutorOptions {
  /** The shared event store */
  eventStore: EventStore;
  /** The pool used to publish events */
  pool: RelayPool;
  /** The host callback approving signing requests */
  approve?: (request: KehtoSignRequest) => boolean | Promise<boolean>;
  /** The executor owning the account operation lifecycle */
  withAccount: ReturnType<typeof createAccountExecutor>;
  /** The loader resolving publication relays for an account */
  writeRelays: (pubkey: string) => Promise<string[]>;
}

/** Creates an action executor with approval, guarded signing, and store-backed publishing */
export function createActionExecutor(config: ActionExecutorOptions) {
  const { eventStore, withAccount, writeRelays } = config;

  async function runAction(windowId: string, action: (tools: ActionTools) => Promise<void>) {
    try {
      return await withAccount(async ({ account, signal }) => {
        // Check again after approval: a timed-out prompt must never sign or publish later.
        const signer: ISigner = {
          nip04: account.signer.nip04,
          nip44: account.signer.nip44,
          getPublicKey: async () => {
            signal.throwIfAborted();
            return account.pubkey;
          },
          signEvent: async (template) => {
            signal.throwIfAborted();
            const event = await createApprovingSigner(account.signer, {
              windowId,
              approve: async (request) => {
                signal.throwIfAborted();
                const approved = config.approve ? await config.approve(request) : true;
                signal.throwIfAborted();
                return approved;
              },
              minimumTimestamp: template.created_at,
            })!.signEvent(template);
            signal.throwIfAborted();
            return event;
          },
        };
        let publishedEvent: NostrEvent | undefined;
        const publish = async (signed: NostrEvent, relays?: string[]) => {
          const destinations = relays?.length ? relays : await writeRelays(account.pubkey);
          signal.throwIfAborted();
          await publishThroughStore(config, destinations, signed);
          signal.throwIfAborted();
          publishedEvent = signed;
        };
        const runner = new ActionRunner(eventStore, signer, publish);
        // The guarded publisher inserts events after checking account ownership.
        runner.saveToStore = false;
        await action({ runner, signer, publish, account, signal });
        signal.throwIfAborted();
        return { ok: true, event: publishedEvent, eventId: publishedEvent?.id };
      });
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  return runAction;
}
