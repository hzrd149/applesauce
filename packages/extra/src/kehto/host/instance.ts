import type { ServiceRuntimeContext } from "@kehto/runtime";
import type { ResolvedNapplet } from "@kehto/nip/5d";
import {
  denyNappletControllerAccess,
  originRegistry,
  prepareNappletSrcdoc,
  resolveShellEnvironment,
  type ShellBridge,
  type ShellEnvironment,
} from "@kehto/shell";
import type { KehtoShellAdapter } from "./adapter.js";
import { cleanupAll } from "./cleanup.js";
import type { KehtoNappletInstance } from "./types.js";

interface InstanceContext {
  adapter: KehtoShellAdapter;
  bridge: ShellBridge;
  readyTimeout: number;
  assertHostActive: () => void;
  getRuntimeContext: () => ServiceRuntimeContext | undefined;
  onDestroy: (windowId: string) => void;
}

const mountedFrames = new WeakSet<HTMLIFrameElement>();

/** Creates a napplet instance and its shell initialization handler */
export function createNappletInstance(resolved: ResolvedNapplet, source: "cache" | "fetch", context: InstanceContext) {
  const { adapter, bridge, readyTimeout, assertHostActive, onDestroy } = context;
  const windowId = `napp-${crypto.randomUUID()}`;
  let iframe: HTMLIFrameElement | undefined;
  let sourceWindow: Window | undefined;
  let environment: ShellEnvironment | undefined;
  let instanceDestroyed = false;
  let documentLoaded = false;
  let shellInitialized = false;
  let readySettled = false;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  // Closing an instance is valid even when nobody requested its readiness promise.
  void ready.catch(() => {});

  function assertInstanceActive() {
    assertHostActive();
    if (instanceDestroyed) throw new Error("Napplet instance is destroyed");
  }

  function finishReady() {
    if (readySettled || !documentLoaded || !shellInitialized) return;
    readySettled = true;
    clearTimeout(readyTimer);
    resolveReady();
  }

  function registerFrame() {
    sourceWindow = iframe!.contentWindow!;
    originRegistry.register(sourceWindow, windowId, { dTag: resolved.dTag, aggregateHash: resolved.aggregateHash });
    originRegistry.setEnvironment(sourceWindow, environment!);
  }

  function handleLoad() {
    // An instance represents one document; a subsequent navigation requires a new instance.
    if (documentLoaded) {
      instance.destroy();
      return;
    }
    if (!iframe?.contentWindow) return;
    if (sourceWindow !== iframe.contentWindow) {
      shellInitialized = false;
      registerFrame();
    }
    documentLoaded = true;
    finishReady();
  }

  const instance: KehtoNappletInstance = {
    windowId,
    resolved,
    source,
    get environment() {
      return environment;
    },
    get window() {
      return sourceWindow;
    },
    get destroyed() {
      return instanceDestroyed;
    },
    mount(frame) {
      assertInstanceActive();
      if (iframe === frame) return;
      if (iframe) throw new Error("Napplet instance is already mounted");
      if (!frame.isConnected || !frame.contentWindow) throw new Error("Napplet iframe must be connected");
      if (mountedFrames.has(frame) || originRegistry.getWindowId(frame.contentWindow)) {
        throw new Error("Napplet iframe is already registered");
      }

      environment = resolveShellEnvironment(adapter, { dTag: resolved.dTag, aggregateHash: resolved.aggregateHash });
      if (!environment.capabilities.domains.includes("shell")) throw new Error("Napplet environment must grant shell");
      const srcdoc = prepareNappletSrcdoc(resolved.indexHtml, { domains: environment.capabilities.domains });

      iframe = frame;
      mountedFrames.add(frame);
      // This host executes untrusted documents without same-origin or top-navigation privileges.
      frame.setAttribute("sandbox", "allow-scripts");
      denyNappletControllerAccess(frame);
      registerFrame();
      frame.addEventListener("load", handleLoad);
      readyTimer = setTimeout(() => {
        rejectReady(new Error("Napplet initialization timed out"));
        instance.destroy();
      }, readyTimeout);
      frame.srcdoc = srcdoc;
    },
    whenReady: () => ready,
    send(message) {
      if (instanceDestroyed || !readySettled) return false;

      // Kehto 0.26's recipient map omits intent.deliver. Apply its recipient
      // policy explicitly until the runtime supports this host-owned delivery.
      if (message.type === "intent.deliver") {
        const delivery = "delivery" in message ? message.delivery : undefined;
        if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) return false;
        const fields = delivery as Record<string, unknown>;
        for (const key of ["sender", "archetype", "action", "convention"] as const) {
          if (typeof fields[key] !== "string") return false;
        }
        if (!environment?.capabilities.domains.includes("intent")) return false;
        if (!bridge.runtime.sessionRegistry.isRegistered(windowId)) return false;
        if (!context.getRuntimeContext()?.hasCapability(windowId, "intent:read") || !sourceWindow) return false;
        sourceWindow.postMessage(message, "*");
        return true;
      }

      return context.getRuntimeContext()?.sendToEligibleNapplet(windowId, message) ?? false;
    },
    destroy() {
      if (instanceDestroyed) return;
      instanceDestroyed = true;
      clearTimeout(readyTimer);
      rejectReady(new Error("Napplet instance is destroyed"));
      onDestroy(windowId);
      if (iframe) {
        iframe.removeEventListener("load", handleLoad);
        mountedFrames.delete(iframe);
      }
      const wasMounted = sourceWindow !== undefined;
      sourceWindow = undefined;
      if (wasMounted) {
        cleanupAll([
          () => bridge.runtime.destroyWindow(windowId),
          () => bridge.runtime.sessionRegistry.unregister(windowId),
          () => originRegistry.unregister(windowId),
          // Stop execution while leaving ownership of the DOM element with the app.
          () => {
            iframe!.srcdoc = "";
          },
          () => adapter.relayPool.closeScopedRelay(windowId),
        ]);
      }
    },
  };

  return {
    instance,
    handleShellReady() {
      shellInitialized = true;
      finishReady();
    },
  };
}
