import type { DmServiceOptions } from "@kehto/services";
import { createMultiProtocolDmAdapter, type KehtoDmOptions } from "./dm/multi-protocol.js";

export * from "./dm/types.js";
export * from "./dm/router.js";
export * from "./dm/nostr.js";
export * from "./dm/adapter.js";
export { DmPublicationError, type DmPublicationResult } from "./dm/publication.js";

export * from "./dm/multi-protocol.js";

/**
 * Creates Kehto service options from a multi-protocol DM adapter
 * @throws if protocol ids are empty or duplicated
 */
export function createDmOptions(config: KehtoDmOptions): DmServiceOptions {
  return { adapter: createMultiProtocolDmAdapter(config) };
}
