// Primary entry point for app

import { BehaviorSubject, EventStore } from "applesauce-core";
import { createEventLoaderForStore } from "applesauce-loaders/loaders";
import { RemoteRelayPool } from "./pool/client/index.js";

/**
 * Get the worker URL for use in non-Vite environments.
 *
 * @example
 * ```typescript
 * // For non-Vite environments
 * const workerUrl = getPoolWorkerUrl();
 * const app = new ApplesauceApp(new Worker(workerUrl, { type: "module" }));
 * ```
 */
export function getPoolWorkerUrl(): URL {
  return new URL("./worker/pool.js", import.meta.url);
}

/**
 * Simple class for creating all necessary workers.
 *
 * @example
 * ```typescript
 * // When using Vite, import the worker with ?worker
 * import WorkerPool from "applesauce-threads/worker/pool?worker";
 * const app = new ApplesauceApp(new WorkerPool());
 *
 * // For non-Vite environments
 * import { getPoolWorkerUrl } from "applesauce-threads";
 * const app = new ApplesauceApp(new Worker(getPoolWorkerUrl(), { type: "module" }));
 * ```
 */
export class ApplesauceApp {
  readonly eventStore: EventStore;
  readonly pool: RemoteRelayPool;

  /** Extra relays to use for loading events */
  extraRelays$ = new BehaviorSubject<string[]>([]);

  /** Relays to use for looking up profiles and mailboxes */
  lookupRelays$ = new BehaviorSubject<string[]>(["wss://purplepag.es", "wss://index.hzrd149.com"]);

  constructor(worker: Worker | string | URL) {
    this.eventStore = new EventStore();
    // Convert string/URL to Worker if needed
    const workerInstance =
      typeof worker === "string" || worker instanceof URL ? new Worker(worker, { type: "module" }) : worker;
    this.pool = new RemoteRelayPool(workerInstance);

    /** Create the event loader for the event store */
    createEventLoaderForStore(this.eventStore, this.pool, {
      extraRelays: this.extraRelays$,
      lookupRelays: this.lookupRelays$,
    });
  }

  get ready(): Promise<void> {
    return this.pool.client.ready;
  }
}
