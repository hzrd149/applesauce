import type { ServiceRegistry } from "@kehto/runtime";
import {
  createCommonService,
  createCountService,
  createDmService,
  createIdentityService,
  createListsService,
  createOutboxService,
  createResourceService,
  createUploadService,
} from "@kehto/services";
import type { ShellAdapter } from "@kehto/shell";
import { map } from "rxjs";
import type { Filter } from "applesauce-core/helpers";
import { kehtoAccount$ } from "./foundation/account.js";
import { decryptForNapplet$ } from "./foundation/encryption.js";
import { createKehtoRelayPool } from "./foundation/pool.js";
import { selectRelayTier } from "./foundation/relays.js";
import { createKehtoSigner } from "./foundation/signer.js";
import { configured$, latest } from "./helpers.js";
import { createCommonOptions, type KehtoCommonOptions } from "./services/common.js";
import { createCountOptions } from "./services/count.js";
import { createDmOptions } from "./services/dm.js";
import { createIdentityOptions } from "./services/identity.js";
import { createListsOptions } from "./services/lists.js";
import { createOutboxRouter } from "./services/outbox.js";
import { createResourceOptions, type KehtoResourceOptions } from "./services/resource.js";
import { createUploadOptions } from "./services/upload.js";
import type { KehtoContext } from "./types.js";

export * from "./types.js";
export * from "./services/dm.js";
export * from "./foundation/account.js";
export * from "./foundation/relays.js";
export * from "./foundation/signer.js";
export * from "./foundation/pool.js";
export * from "./services/identity.js";
export * from "./services/outbox.js";
export * from "./services/count.js";
export * from "./services/common.js";
export * from "./services/upload.js";
export * from "./services/lists.js";
export * from "./services/resource.js";

/** The NAP services {@link createKehtoServices} can create */
export type KehtoServiceName = "identity" | "outbox" | "count" | "common" | "upload" | "lists" | "resource" | "dm";

/** Options for {@link createKehtoServices} */
export interface KehtoServicesOptions {
  /** Services to leave out of the registry */
  disable?: KehtoServiceName[];
  /** Approval and signing deadline for common social actions */
  common?: Pick<KehtoCommonOptions, "actionTimeout">;
  /** Resource resolution options and application protocol handlers */
  resource?: Omit<KehtoResourceOptions, "eventStore" | "pubkey">;
}

/** Creates a kehto service registry for every NAP service applesauce can answer */
export function createKehtoServices(context: KehtoContext, options?: KehtoServicesOptions): ServiceRegistry {
  const isEnabled = (name: KehtoServiceName) => !options?.disable?.includes(name);
  const services: ServiceRegistry = {};
  const account$ = kehtoAccount$(context);
  const pubkey = account$.pipe(map((account) => account?.pubkey));
  const { eventStore, pool, timeout, fallbackRelays, approve } = context;

  if (isEnabled("dm")) {
    let sendingWindow: string | undefined;
    const dm = createDmService(
      createDmOptions({
        eventStore,
        pool,
        account$,
        timeout,
        fallbackRelays,
        approve,
        getWindowId: () => sendingWindow,
      }),
    );
    services.dm = {
      ...dm,
      handleMessage: (windowId, message, send) => {
        sendingWindow = windowId;
        dm.handleMessage(windowId, message, send);
      },
    };
  }

  if (isEnabled("identity"))
    services.identity = createIdentityService(
      createIdentityOptions({ eventStore, pool, account$, timeout, fallbackRelays }),
    );
  if (isEnabled("count"))
    services.count = createCountService(createCountOptions({ eventStore, pool, pubkey, timeout, fallbackRelays }));
  if (isEnabled("common"))
    services.common = createCommonService(
      createCommonOptions({ eventStore, pool, account$, timeout, fallbackRelays, approve, ...options?.common }),
    );
  if (isEnabled("upload"))
    services.upload = createUploadService(
      createUploadOptions({ eventStore, account$, timeout, approve, fallbackServers: context.fallbackBlossomServers }),
    );
  if (isEnabled("lists"))
    services.lists = createListsService(
      createListsOptions({ eventStore, pool, account$, timeout, fallbackRelays, approve }),
    );
  if (isEnabled("resource"))
    services.resource = createResourceService(
      createResourceOptions({
        eventStore,
        pubkey,
        timeout,
        fallbackServers: context.fallbackBlossomServers,
        ...options?.resource,
      }),
    );

  if (isEnabled("outbox")) {
    // outbox.publish carries no window id, so remember the sender for the signing approval
    let publishingWindow: string | undefined;
    const outbox = createOutboxService({
      router: createOutboxRouter({
        eventStore,
        pool,
        account$,
        timeout,
        fallbackRelays,
        approve,
        decrypt: context.decrypt,
        decryptionCache: context.decryptionCache,
        getWindowId: () => publishingWindow,
      }),
    });
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

/** A Kehto shell adapter with explicit subscription cleanup */
export interface KehtoShellAdapter extends ShellAdapter {
  /** Stops shell snapshots, services and tracked relay subscriptions */
  stop(): void;
}

/**
 * Creates a complete kehto {@link ShellAdapter} backed by applesauce, including the service registry
 * @example
 * const bridge = createShellBridge(createKehtoShellAdapter({ pool, eventStore, signer: manager.active$ }));
 * window.addEventListener("message", bridge.handleMessage);
 */
export function createKehtoShellAdapter(
  context: KehtoContext,
  options?: KehtoServicesOptions & { overrides?: Partial<ShellAdapter> },
): KehtoShellAdapter {
  const account = latest(kehtoAccount$(context), undefined);
  const fallbackRelays = latest(configured$(context.fallbackRelays, []), []);
  const relayPool = createKehtoRelayPool(context, (event) => decryptForNapplet$(context, event));
  const subscriptions = new Map<string, () => void>();
  const services = createKehtoServices(context, options);
  const available = { isAvailable: () => true };
  const registeredServices = { ...services, ...options?.overrides?.services };

  return {
    stop: () => {
      account.stop();
      fallbackRelays.stop();
      for (const cleanup of subscriptions.values()) cleanup();
      subscriptions.clear();
      for (const service of Object.values(registeredServices)) service?.onUnregistered?.();
    },
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
      selectRelayTier: (filters) =>
        selectRelayTier(context.eventStore, filters as Filter[], account.get()?.pubkey, fallbackRelays.get()),
    },
    relayConfig: {
      addRelay: () => {},
      removeRelay: () => {},
      getRelayConfig: () => ({
        discovery: [],
        super: [],
        outbox: selectRelayTier(context.eventStore, [], account.get()?.pubkey, fallbackRelays.get()),
      }),
      getNip66Suggestions: () => [],
    },
    auth: {
      getUserPubkey: () => account.get()?.pubkey ?? null,
      getSigner: (windowId) => createKehtoSigner(account.get()?.signer, context, windowId),
    },
    // Follow the store's verification policy
    crypto: { verifyEvent: async (event) => context.eventStore.verifyEvent?.(event) ?? true },
    windowManager: { createWindow: () => null },
    config: { getNappUpdateBehavior: () => "banner" },
    hotkeys: { executeHotkeyFromForward: () => {} },
    // The relay pool above already reads and writes the event store
    workerRelay: { getWorkerRelay: () => null },
    common: services.common ? available : undefined,
    lists: services.lists ? available : undefined,
    upload: services.upload ? { getUploader: () => ({ rails: ["blossom"] }) } : undefined,
    ...options?.overrides,
    services: registeredServices,
  };
}
