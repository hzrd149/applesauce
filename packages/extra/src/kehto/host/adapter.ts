import type { ServiceRegistry } from "@kehto/runtime";
import type { ShellAdapter } from "@kehto/shell";
import type { Filter } from "applesauce-core/helpers";
import { kehtoAccount$ } from "../foundation/account.js";
import { decryptForNapplet$ } from "../foundation/encryption.js";
import { createKehtoRelayPool } from "../foundation/pool.js";
import { relaySelection$, selectRelayTier } from "../foundation/relays.js";
import { createKehtoSigner } from "../foundation/signer.js";
import { configured$, latest } from "../helpers.js";
import type { KehtoContext } from "../types.js";

/** Partial shell hook groups for extending the applesauce defaults */
export type KehtoShellOverrides = {
  [Key in Exclude<keyof ShellAdapter, "services">]?: NonNullable<ShellAdapter[Key]> extends (
    ...args: never[]
  ) => unknown
    ? ShellAdapter[Key]
    : Partial<NonNullable<ShellAdapter[Key]>>;
};

/** Options for composing an applesauce-backed shell adapter */
export interface KehtoShellAdapterOptions {
  /** The complete service registry, with no services included when omitted */
  services?: ServiceRegistry;
  /** Partial shell hooks that extend the applesauce defaults */
  overrides?: KehtoShellOverrides;
}

/** Options for stopping an adapter whose services may be owned by a runtime */
export interface KehtoStopOptions {
  /** Whether to unregister services (default true; pass false after destroying the bridge) */
  services?: boolean;
}

/** A Kehto shell adapter with explicit subscription cleanup */
export interface KehtoShellAdapter extends ShellAdapter {
  /** Stops shell snapshots, services and tracked relay subscriptions */
  stop(options?: KehtoStopOptions): void;
}

/**
 * Creates an applesauce-backed shell adapter with optional host hooks and a service registry
 * @example
 * const bridge = createShellBridge(createKehtoShellAdapter({ pool, eventStore, signer: manager.active$ }));
 * window.addEventListener("message", bridge.handleMessage);
 */
export function createKehtoShellAdapter(context: KehtoContext, options?: KehtoShellAdapterOptions): KehtoShellAdapter {
  const account = latest(kehtoAccount$(context), undefined);
  const fallbackRelays = latest(configured$(context.fallbackRelays, []), []);
  const selection = latest(relaySelection$(context.pool, context.relaySelection), {});
  const relayPool = createKehtoRelayPool(context, (event) => decryptForNapplet$(context, event));
  const subscriptions = new Map<string, () => void>();
  const services = { ...options?.services };
  const available = { isAvailable: () => true };
  let stopped = false;

  const adapter: KehtoShellAdapter = {
    stop: (stopOptions) => {
      if (stopped) return;
      stopped = true;
      account.stop();
      fallbackRelays.stop();
      selection.stop();
      for (const cleanup of subscriptions.values()) cleanup();
      subscriptions.clear();
      if (stopOptions?.services !== false) {
        for (const service of Object.values(services)) service?.onUnregistered?.();
      }
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
        selectRelayTier(
          context.eventStore,
          filters as Filter[],
          account.get()?.pubkey,
          fallbackRelays.get(),
          selection.get(),
        ),
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
    services,
  };

  // These domains require both a registered service and an availability hook in kehto.
  for (const domain of ["intent", "link", "serial", "ble", "webrtc"] as const) {
    if (services[domain]) adapter[domain] = available;
  }

  const overrides = options?.overrides;
  if (overrides) {
    for (const key of Object.keys(overrides) as (keyof KehtoShellOverrides)[]) {
      const value = overrides[key];
      const current = adapter[key];
      (adapter as unknown as Record<string, unknown>)[key] =
        value && typeof value === "object" && current && typeof current === "object" ? { ...current, ...value } : value;
    }
  }

  return adapter;
}
