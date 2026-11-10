import type { EventTemplate } from "applesauce-core/helpers";
import { defer, firstValueFrom, timeout } from "rxjs";
import type { NostrMessageProtocolOptions } from "./nostr-options.js";
import type { DmOperationContext } from "./types.js";

/**
 * Asks the host to approve a plaintext message before a protocol encrypts or signs it
 * @throws if no approval callback is configured, the host denies the message, approval times out, or the operation is aborted
 */
export async function approveMessage(
  config: Pick<NostrMessageProtocolOptions, "approve" | "actionTimeout">,
  template: EventTemplate,
  context: DmOperationContext,
): Promise<void> {
  const { approve } = config;
  if (!approve) throw new Error("No approval callback configured");

  const approval$ = defer(async () => approve({ template, windowId: context.windowId }));
  const approved = await firstValueFrom(approval$.pipe(timeout({ first: config.actionTimeout ?? 120000 })));

  context.signal.throwIfAborted();
  if (!approved) throw new Error("User denied");
}
