import { ReportFactory } from "applesauce-common/factories/report";
import { ReportReason } from "applesauce-common/helpers/reports";
import { ReportEventTarget } from "applesauce-common/operations/report";
import { Action } from "../action-runner.js";

function publishReport(factory: ReportFactory): Action {
  return async ({ signer, user, publish }) => {
    const event = await factory.sign(signer);
    const outboxes = await user.outboxes$.$first(1_000, undefined);
    await publish(event, outboxes?.length ? outboxes : undefined);
  };
}

/**
 * Creates a user report and publishes it to the reporter's outboxes
 * @throws if the public key or reason is invalid, or signing or publishing fails
 */
export function ReportUser(pubkey: string, reason: ReportReason, comment = ""): Action {
  return publishReport(ReportFactory.create(pubkey, reason).content(comment));
}

/**
 * Creates an event report and publishes it to the reporter's outboxes
 * @throws if the event identity or reason is invalid, or signing or publishing fails
 */
export function ReportEvent(event: ReportEventTarget, reason: ReportReason, comment = ""): Action {
  return publishReport(ReportFactory.create(event, reason).content(comment));
}

/**
 * Creates a blob report and publishes it to the reporter's outboxes
 * @throws if the hash, event identity, reason, or servers are invalid, or signing or publishing fails
 */
export function ReportBlob(
  hash: string,
  event: ReportEventTarget,
  reason: ReportReason,
  comment = "",
  servers: string[] = [],
): Action {
  let factory = ReportFactory.blob(hash, event, reason).content(comment);
  for (const server of servers) factory = factory.server(server);
  return publishReport(factory);
}
