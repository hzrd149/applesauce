import type { ServiceRegistry } from "@kehto/runtime";
import {
  createCommonService,
  createCountService,
  createIdentityService,
  createOutboxService,
  createUploadService,
} from "@kehto/services";
import type { ShellAdapter } from "@kehto/shell";
import type { Filter } from "applesauce-core/helpers";
import { createKehtoRelayPool } from "./foundation/pool.js";
import { selectRelayTier } from "./foundation/relays.js";
import { createKehtoSigner } from "./foundation/signer.js";
import { createKehtoState, type KehtoState } from "./foundation/state.js";
import { createCommonOptions } from "./services/common.js";
import { createCountOptions } from "./services/count.js";
import { createIdentityOptions } from "./services/identity.js";
import { createOutboxRouter } from "./services/outbox.js";
import { createUploadOptions } from "./services/upload.js";
import type { KehtoContext } from "./types.js";

export * from "./types.js";
export * from "./foundation/state.js";
export * from "./foundation/relays.js";
export * from "./foundation/signer.js";
export * from "./foundation/pool.js";
export * from "./services/identity.js";
export * from "./services/outbox.js";
export * from "./services/count.js";
export * from "./services/common.js";
export * from "./services/upload.js";

/** The NAP services {@link createKehtoServices} can create */
export type KehtoServiceName = "identity" | "outbox" | "count" | "common" | "upload";

/** Options for {@link createKehtoServices} */
export interface KehtoServicesOptions {
  /** Services to leave out of the registry */
  disable?: KehtoServiceName[];
}

const toState = (input: KehtoContext | KehtoState): KehtoState =>
  "getSigner" in input ? input : createKehtoState(input);

/** Creates a kehto service registry for every NAP service applesauce can answer */
export function createKehtoServices(input: KehtoContext | KehtoState, options?: KehtoServicesOptions): ServiceRegistry {
  const state = toState(input);
  const enabled = (name: KehtoServiceName) => !options?.disable?.includes(name);
  const services: ServiceRegistry = {};

  if (enabled("identity")) services.identity = createIdentityService(createIdentityOptions(state));
  if (enabled("count")) services.count = createCountService(createCountOptions(state));
  if (enabled("common")) services.common = createCommonService(createCommonOptions(state));
  if (enabled("upload")) services.upload = createUploadService(createUploadOptions(state));

  if (enabled("outbox")) {
    // outbox.publish carries no window id, so remember the sender for the signing approval
    let publishingWindow: string | undefined;
    const outbox = createOutboxService({ router: createOutboxRouter(state, () => publishingWindow) });
    services.outbox = {
      ...outbox,
      handleMessage: (windowId, message, send) => {
        // The router reads this synchronously inside handleMessage, before any await
        publishingWindow = windowId;
        outbox.handleMessage(windowId, message, send);
      },
    };
  }

  return services;
}

/**
 * Creates a complete kehto {@link ShellAdapter} backed by applesauce, including the service registry
 * @example
 * const bridge = createShellBridge(createKehtoShellAdapter({ pool, eventStore, signer: manager.active$ }));
 * window.addEventListener("message", bridge.handleMessage);
 */
export function createKehtoShellAdapter(
  input: KehtoContext | KehtoState,
  options?: KehtoServicesOptions & { overrides?: Partial<ShellAdapter> },
): ShellAdapter {
  const state = toState(input);
  const relayPool = createKehtoRelayPool(state);
  const subscriptions = new Map<string, () => void>();
  const services = createKehtoServices(state, options);
  const available = { isAvailable: () => true };

  return {
    relayPool: {
      getRelayPool: () => relayPool,
      trackSubscription: (key, cleanup) => subscriptions.set(key, cleanup),
      untrackSubscription: (key) => {
        subscriptions.get(key)?.();
        subscriptions.delete(key);
      },
      // Scoped relays are not supported, napplets read through the shared pool
      openScopedRelay: () => {},
      closeScopedRelay: () => {},
      publishToScopedRelay: () => false,
      // Kehto's NostrFilter is structurally a NIP-01 filter
      selectRelayTier: (filters) => selectRelayTier(state, filters as Filter[]),
    },
    relayConfig: {
      addRelay: () => {},
      removeRelay: () => {},
      getRelayConfig: () => ({ discovery: [], super: [], outbox: selectRelayTier(state, []) }),
      getNip66Suggestions: () => [],
    },
    auth: {
      getUserPubkey: () => state.getPubkey() ?? null,
      getSigner: (windowId) => createKehtoSigner(state, windowId),
    },
    // Follow the store's verification policy
    crypto: { verifyEvent: async (event) => state.ctx.eventStore.verifyEvent?.(event) ?? true },
    windowManager: { createWindow: () => null },
    config: { getNappUpdateBehavior: () => "banner" },
    hotkeys: { executeHotkeyFromForward: () => {} },
    // The relay pool above already reads and writes the event store
    workerRelay: { getWorkerRelay: () => null },
    common: services.common ? available : undefined,
    upload: services.upload ? { getUploader: () => ({ rails: ["blossom"] }) } : undefined,
    ...options?.overrides,
    services: { ...services, ...options?.overrides?.services },
  };
}
