import type { CommonServiceOptions } from "@kehto/services";
import { ReactionFactory } from "applesauce-common/factories";
import { getInboxes, kinds, mergeRelaySets } from "applesauce-core/helpers";
import { settle } from "../../helpers.js";
import type { CommonContext } from "./context.js";

/** Creates reaction publishing with author inbox routing */
export function createReactionService({
  timeout,
  eventStore,
  runAction,
  loadEvent,
  writeRelays,
}: Pick<CommonContext, "timeout" | "eventStore" | "runAction" | "loadEvent" | "writeRelays">): Pick<
  CommonServiceOptions,
  "react"
> {
  return {
    react: (id, reaction, href, { windowId }) =>
      runAction(windowId, async ({ signer, publish, account }) => {
        const target = await loadEvent(id);
        const emoji = href ? { shortcode: reaction.replace(/^:|:$/g, ""), url: href } : reaction;
        const event = await ReactionFactory.create(target, emoji).sign(signer);
        // Load both relay lists through the host loaders before routing the reaction.
        const [outboxes, mailboxes] = await Promise.all([
          writeRelays(account.pubkey),
          settle(eventStore.replaceable(kinds.RelayList, target.pubkey), undefined, timeout),
        ]);
        await publish(event, mergeRelaySets(outboxes, mailboxes ? getInboxes(mailboxes) : []));
      }),
  };
}
