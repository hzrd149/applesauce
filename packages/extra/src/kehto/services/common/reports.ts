import type { CommonServiceOptions } from "@kehto/services";
import { type CommonContext, toPubkey } from "./context.js";
import { ReportEvent, ReportUser } from "applesauce-actions/actions";
import type { ReportReason } from "applesauce-common/helpers";

/** Creates user and event report actions */
export function createReportService({
  runAction,
  loadEvent,
}: Pick<CommonContext, "runAction" | "loadEvent">): Pick<CommonServiceOptions, "report"> {
  return {
    report: (target, reason, text, { windowId }) =>
      runAction(windowId, async ({ runner }) => {
        if (target.type === "pubkey") {
          return runner.run(ReportUser, toPubkey(target.pubkey), reason as ReportReason, text);
        }

        const pubkey = target.pubkey ? toPubkey(target.pubkey) : (await loadEvent(target.id)).pubkey;
        await runner.run(ReportEvent, { id: target.id, pubkey }, reason as ReportReason, text);
      }),
  };
}
