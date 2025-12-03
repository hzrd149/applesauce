/// <reference lib="webworker" />
import { Debugger } from "debug";
import { filter, fromEvent, merge, share, Subject, takeUntil } from "rxjs";
import { logger } from "./debug.js";
import type { RPCCommandDirectory, RPCMessage, RPCResponseComplete } from "./interface.js";
import { RPCServer } from "./rpc-server.js";

/**
 * Service Worker RPC Server integration.
 * This connects the base RPCServer to the worker's message system.
 *
 * @example
 * ```typescript
 * const rpcServer = new RPCServer<AppCommands>();
 *
 * rpcServer.register("myCommand", (payload) => {
 *   return of({ result: `Processed: ${payload.param}` });
 * });
 *
 * setupServiceWorkerRPCServer(rpcServer);
 * ```
 */
export function connectWorkerRPCServer<Commands extends RPCCommandDirectory>(
  server: RPCServer<Commands>,
  name?: string,
): void {
  const log: Debugger = logger.extend(name ?? "WorkerRPCServer");

  // Create a shared Observable from message events
  const messages = fromEvent<MessageEvent>(self, "message").pipe(
    filter((event) => Reflect.has(event.data, "type")),
    share(),
  );

  messages.subscribe((message) => {
    const data = message.data as RPCMessage;

    if (data.type === "CALL") {
      log("← %s (%s) %o", data.command, data.id, data.payload);
      const clientDisconnect$ = new Subject<void>();

      server
        .call(data.id, data.command, data.payload)
        .pipe(
          takeUntil(
            merge(messages.pipe(filter((e) => e.data.id === data.id && e.data.type === "CLOSE")), clientDisconnect$),
          ),
        )
        .subscribe({
          next: (response) => {
            try {
              if (response.type === "RESULT") {
                log("→ %s (%s) RESULT %o", data.command, response.id, response.value);
              } else if (response.type === "ERROR") {
                log("→ %s (%s) ERROR %s", data.command, response.id, response.error);
              }
              (message.source ?? self).postMessage(response);
            } catch (error) {
              // Client disconnected, trigger cleanup
              clientDisconnect$.next();
              clientDisconnect$.complete();
            }
          },
          complete: () => {
            try {
              const completeMessage = {
                id: data.id,
                type: "COMPLETE",
              } satisfies RPCResponseComplete;
              log("→ %s (%s) COMPLETE", data.command, data.id);
              (message.source ?? self).postMessage(completeMessage);
            } catch (error) {
              // Client disconnected, ignore
            }
          },
        });
    } else if (data.type === "CLOSE") {
      log("← CLOSE (%s)", data.id);
    }
  });

  // Send READY message when server is connected
  const readyMessage = server.ready();
  log("→ READY");
  self.postMessage(readyMessage);
}
