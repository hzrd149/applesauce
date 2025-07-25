import { blueprint } from "applesauce-factory/event-factory";
import { setContent } from "applesauce-factory/operations/content";
import { includeNameValueTag, includeSingletonTag } from "applesauce-factory/operations/tags";
import { NostrEvent } from "nostr-tools";

import { DVM_STATUS_KIND } from "../helpers/kinds.js";
import { JobStatus } from "../helpers/status.js";

/** A blueprint for a simple machine status event */
export function MachineStatusBlueprint(request: NostrEvent, message: string, status: JobStatus) {
  return blueprint(
    DVM_STATUS_KIND,
    setContent(message),
    includeSingletonTag(["status", status]),
    includeNameValueTag(["e", request.id]),
    includeNameValueTag(["p", request.pubkey]),
  );
}

/** A blueprint for a payment-required status event */
export function MachinePaymentStatusBlueprint(
  request: NostrEvent,
  amount: number,
  options?: { message?: string; bolt11?: string },
) {
  return blueprint(
    DVM_STATUS_KIND,
    setContent(options?.message ?? "Payment required"),
    includeSingletonTag(["status", JobStatus.PAYMENT]),
    includeSingletonTag(["amount", String(amount), options?.bolt11].filter(Boolean) as [string, ...string[]]),
    includeNameValueTag(["e", request.id]),
    includeNameValueTag(["p", request.pubkey]),
  );
}
