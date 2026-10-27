import type { ServiceHandler } from "@kehto/runtime";
import { createCvmService, type CvmService, type CvmServiceOptions, type CvmTransport } from "@kehto/services";
import { createNostrCvmTransport, type NostrCvmTransportOptions } from "@kehto/services/cvm-nostr-transport";
import type { Filter } from "applesauce-core/helpers";
import { Subscription } from "rxjs";
import { subscribeThroughStore, type KehtoPoolContext } from "../foundation/pool.js";

/** Options for an ephemeral-key ContextVM service over the host's shared relay pool */
export interface KehtoCvmOptions {
  /** The discovery and request relays used when no explicit relay hints are supplied */
  defaultRelays?: string[];
  /** The default MCP request timeout in milliseconds */
  timeoutMs?: number;
  /** The client information advertised during MCP initialization */
  clientInfo?: NostrCvmTransportOptions["clientInfo"];
  /** The idle interval before probing an open stream in milliseconds */
  streamIdleTimeoutMs?: number;
  /** The deadline for an open stream's keepalive response in milliseconds */
  streamProbeTimeoutMs?: number;
}

/** A ContextVM service with explicit, idempotent cleanup */
export interface KehtoCvmService extends ServiceHandler {
  /** Releases all window transports without closing the shared pool or store */
  dispose(): void;
}

/** A ContextVM transport owning one ephemeral client identity and its subscriptions */
export interface KehtoCvmTransport extends CvmTransport {
  /** Releases transport resources without closing the shared pool or clearing the store */
  dispose(): void;
}

/** Creates an encrypted ContextVM transport with its own ephemeral key over the shared pool and store */
export function createCvmTransport(context: KehtoPoolContext, options: KehtoCvmOptions = {}): KehtoCvmTransport {
  const subscriptions = new Subscription();
  const transport = createNostrCvmTransport({
    ...options,
    // Never use the active account to sign MCP traffic or expose its keys.
    pool: {
      subscribe: (relays, filter, callbacks) => {
        if (subscriptions.closed) throw new Error("CVM transport disposed");
        const subscription = subscribeThroughStore(context, relays, [filter as Filter]).subscribe((item) => {
          if (item === "EOSE") callbacks.oneose?.();
          else callbacks.onevent?.(item);
        });
        subscriptions.add(subscription);
        return { close: () => subscription.unsubscribe() };
      },
      publish: async (relays, event) => {
        if (subscriptions.closed) throw new Error("CVM transport disposed");
        const results = await context.pool.publish(relays, event);
        if (!results.some((result) => result.ok)) {
          throw new Error(results[0]?.message ?? "No relay accepted the CVM event");
        }

        context.eventStore.add(event);
      },
    },
  });

  return {
    ...transport,
    discover: async (query) => {
      if (subscriptions.closed) throw new Error("CVM transport disposed");
      return transport.discover(query);
    },
    request: async (server, message, requestOptions) => {
      if (subscriptions.closed) throw new Error("CVM transport disposed");
      return transport.request(server, message, requestOptions);
    },
    onEvent: (handler) => {
      if (subscriptions.closed) return { close: () => {} };
      return transport.onEvent(handler);
    },
    dispose: () => {
      if (subscriptions.closed) return;
      subscriptions.unsubscribe();
      transport.dispose();
    },
  };
}

/** Creates Kehto service options owning one ContextVM transport that the service or caller must dispose */
export function createCvmOptions(
  context: KehtoPoolContext,
  options: KehtoCvmOptions = {},
): CvmServiceOptions & { transport: KehtoCvmTransport } {
  return { transport: createCvmTransport(context, options) };
}

/** Creates a ContextVM service with isolated window sessions and shell-owned ephemeral keys */
export function createKehtoCvmService(context: KehtoPoolContext, options: KehtoCvmOptions = {}): KehtoCvmService {
  const windows = new Map<string, CvmService>();
  let disposed = false;

  function destroyWindow(windowId: string) {
    const window = windows.get(windowId);
    if (!window) return;

    // Invalidate pending replies before disposing the transport's requests.
    windows.delete(windowId);
    window.dispose();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const windowId of windows.keys()) destroyWindow(windowId);
  }

  return {
    descriptor: { name: "cvm", version: "1.0.0", description: "Applesauce-backed NAP-CVM service" },
    handleMessage: (windowId, message, send) => {
      if (disposed || !["cvm.discover", "cvm.request", "cvm.close"].includes(message.type)) return;

      let window = windows.get(windowId);
      if (!window) {
        window = createCvmService(createCvmOptions(context, options));
        windows.set(windowId, window);
      }

      const currentWindow = window;
      window.handleMessage(windowId, message, (reply) => {
        if (windows.get(windowId) === currentWindow) send(reply);
      });
    },
    onWindowDestroyed: destroyWindow,
    onUnregistered: dispose,
    dispose,
  };
}
