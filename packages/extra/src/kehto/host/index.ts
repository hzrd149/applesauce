import type { ServiceRuntimeContext } from "@kehto/runtime";
import { fetchBlob, resolveNapplet } from "@kehto/nip/5d";
import { createShellBridge, originRegistry } from "@kehto/shell";
import { castUser } from "applesauce-common/casts";
import { mergeBlossomServers } from "applesauce-common/helpers";
import { distinctUntilChanged, map, skip } from "rxjs";
import { kehtoAccount$ } from "../foundation/account.js";
import { configured$, settle } from "../helpers.js";
import { createKehtoShellAdapter } from "./adapter.js";
import type { KehtoContext } from "../types.js";
import { cleanupAll } from "./cleanup.js";
import { createNappletInstance } from "./instance.js";
import type { KehtoHost, KehtoHostOptions } from "./types.js";

export type * from "./types.js";

/**
 * Creates a browser host with applesauce services, message routing, and per-instance cleanup
 * @throws if called outside a browser or readyTimeout is not a positive finite number
 */
export function createKehtoHost(context: KehtoContext, options: KehtoHostOptions = {}): KehtoHost {
  if (typeof window === "undefined") throw new Error("Kehto hosts require a browser window");
  const readyTimeout = options.readyTimeout ?? 10000;
  if (!Number.isFinite(readyTimeout) || readyTimeout <= 0) throw new Error("readyTimeout must be positive and finite");

  const adapter = createKehtoShellAdapter(context, { ...options, overrides: options.shell });
  let runtimeContext: ServiceRuntimeContext | undefined;
  for (const [name, service] of Object.entries(adapter.services ?? {})) {
    adapter.services![name] = {
      ...service,
      onRegistered(registeredContext) {
        runtimeContext = registeredContext;
        service.onRegistered?.(registeredContext);
      },
    };
  }
  const bridge = createShellBridge(adapter);
  const instances = new Map<string, ReturnType<typeof createNappletInstance>>();
  const fetchController = new AbortController();
  let destroyed = false;

  function assertActive() {
    if (destroyed) throw new Error("Kehto host is destroyed");
  }

  function handleMessage(event: MessageEvent) {
    const source = event.source as Window | null;
    const windowId = source ? originRegistry.getWindowId(source) : undefined;
    if (!windowId || !instances.has(windowId)) return;

    bridge.handleMessage(event);

    // The installed bridge posts shell.init synchronously after accepting shell.ready.
    // This observes that transition; it does not acknowledge receipt in the child.
    if (event.data?.type === "shell.ready" && bridge.runtime.sessionRegistry.isRegistered(windowId)) {
      instances.get(windowId)?.handleShellReady();
    }
  }

  window.addEventListener("message", handleMessage);
  const identitySubscription = kehtoAccount$(context)
    .pipe(
      map((account) => account?.pubkey ?? ""),
      distinctUntilChanged(),
      skip(1),
    )
    .subscribe((pubkey) => bridge.publishIdentityChanged(pubkey));

  return {
    bridge,
    async resolve(event, resolveOptions) {
      assertActive();
      let source: "cache" | "fetch" = "cache";
      const resolved = await resolveNapplet({
        event,
        cache: resolveOptions?.cache ?? options.cache,
        fetchBlob: async (hash, servers) => {
          assertActive();
          source = "fetch";
          if (resolveOptions?.fetchBlob) return resolveOptions.fetchBlob(hash, servers);
          const authorServers = await settle(
            castUser(event.pubkey, context.eventStore).blossomServers$,
            [],
            servers.length ? 0 : (context.timeout ?? 4000),
          );
          assertActive();
          const preferred = mergeBlossomServers<string | URL>([...servers], authorServers).map(String);
          const locations = preferred.length
            ? preferred
            : await settle(configured$(context.fallbackBlossomServers, []), [], context.timeout ?? 4000);
          return fetchBlob(locations, hash, async (url) => {
            assertActive();
            const response = await (options.fetch ?? fetch)(url, { signal: fetchController.signal });
            if (!response.ok) throw new Error(`Artifact fetch failed: ${response.status}`);
            return new Uint8Array(await response.arrayBuffer());
          });
        },
      });
      assertActive();
      const controller = createNappletInstance(resolved, source, {
        adapter,
        bridge,
        readyTimeout,
        assertHostActive: assertActive,
        getRuntimeContext: () => runtimeContext,
        onDestroy: (windowId) => {
          instances.delete(windowId);
        },
      });
      instances.set(controller.instance.windowId, controller);
      return controller.instance;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      fetchController.abort();
      window.removeEventListener("message", handleMessage);
      identitySubscription.unsubscribe();
      runtimeContext = undefined;
      const instanceCleanups = [...instances.values()].map(
        ({ instance }) =>
          () =>
            instance.destroy(),
      );
      cleanupAll([...instanceCleanups, () => bridge.destroy(), () => adapter.stop({ services: false })]);
    },
  };
}
