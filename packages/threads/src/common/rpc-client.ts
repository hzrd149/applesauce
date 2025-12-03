import { Debugger } from "debug";
import { nanoid } from "nanoid";
import { firstValueFrom, Observable, filter, finalize, map, takeWhile } from "rxjs";
import { logger } from "./debug.js";
import type {
  RPCCommandDirectory,
  RPCCommandName,
  RPCCommandPayload,
  RPCCommandResult,
  RPCMessage,
  RPCResponse,
} from "./interface.js";

/**
 * RPC Client for making type-safe RPC calls to a worker or service worker.
 *
 * @example
 * ```typescript
 * const client = new RPCClient(
 *   fromEvent<MessageEvent>(worker, "message").pipe(
 *     map(e => e.data as RPCResponse)
 *   ),
 *   (msg) => worker.postMessage(msg)
 * );
 *
 * client.call("getConfig", void 0)
 *   .subscribe({
 *     next: (config) => console.log("Got config:", config),
 *     error: (err) => console.error("Error:", err)
 *   });
 * ```
 */
export class RPCClient<Commands extends RPCCommandDirectory = RPCCommandDirectory> {
  private readonly log: Debugger;
  private readyPromise: Promise<void> | null = null;

  constructor(
    private readonly incoming: Observable<RPCResponse>,
    private readonly outgoing: (message: RPCMessage) => void,
    name?: string,
  ) {
    this.log = logger.extend(name ?? "RPCClient");
  }

  /**
   * Makes a type-safe RPC call to the worker.
   *
   * @param command - The command name (must be defined in Commands)
   * @param payload - The command payload (typed based on command)
   * @returns An Observable that emits result values and completes when done
   */
  call<Command extends RPCCommandName<Commands>>(
    command: Command,
    payload: RPCCommandPayload<Commands, Command>,
  ): Observable<RPCCommandResult<Commands, Command>> {
    const id = nanoid(8);

    // Send the CALL message
    const message: RPCMessage = {
      type: "CALL",
      id,
      command,
      payload,
    };
    this.log("→ %s (%s) %o", command, id, payload);
    this.outgoing(message);

    // Filter responses for this specific request ID
    return this.incoming.pipe(
      filter((response) => response.type !== "READY" && response.id === id),
      takeWhile((response) => response.type !== "COMPLETE", true),
      map((response) => {
        if (response.type === "RESULT") {
          this.log("← %s (%s) RESULT %o", command, id, response.value);
          return response.value as RPCCommandResult<Commands, Command>;
        }
        if (response.type === "ERROR") {
          this.log("← %s (%s) ERROR %s", command, id, response.error);
          throw new Error(response.error);
        }
        if (response.type === "COMPLETE") {
          this.log("← %s (%s) COMPLETE", command, id);
        }
        // COMPLETE message - this will be filtered out by takeWhile
        return undefined as unknown as RPCCommandResult<Commands, Command>;
      }),
      filter((value): value is RPCCommandResult<Commands, Command> => value !== undefined),
      finalize(() => {
        // Send CLOSE message on unsubscribe to clean up on the worker side
        const closeMessage: RPCMessage = {
          type: "CLOSE",
          id,
        };
        this.log("→ CLOSE (%s)", id);
        this.outgoing(closeMessage);
      }),
    );
  }

  /**
   * Returns a Promise that resolves when the worker sends a READY message.
   * If the worker has already sent a READY message, the Promise resolves immediately.
   *
   * @returns A Promise that resolves when the worker is ready
   */
  get ready(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = firstValueFrom(
      this.incoming.pipe(
        filter((response) => response.type === "READY"),
        map(() => {
          this.log("← READY");
          return undefined;
        }),
      ),
    );

    return this.readyPromise;
  }
}
