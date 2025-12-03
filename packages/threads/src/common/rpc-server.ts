import { Debugger } from "debug";
import { catchError, from, map, Observable, of, switchMap } from "rxjs";
import { logger } from "./debug.js";
import type {
  RPCCommandDirectory,
  RPCCommandName,
  RPCCommandPayload,
  RPCCommandResult,
  RPCResponse,
  RPCResponseError,
  RPCResponseReady,
  RPCResponseResult,
} from "./interface.js";

/**
 * Handler function type for RPC commands.
 * Can return Observable, Promise, or a direct value.
 */
export type RPCHandler<Payload, Result> = (
  payload: Payload,
) => Observable<Result> | Promise<Result> | Promise<Observable<Result>> | Result;

/**
 * RPC Server for handling RPC calls from clients.
 *
 * @example
 * ```typescript
 * const server = new RPCServer<MyCommands>();
 *
 * server.register("getData", (payload) => {
 *   return of({ data: "result" }); // Returns Observable
 * });
 *
 * server.register("fetchData", async (payload) => {
 *   const data = await fetch("/api/data");
 *   return data.json();
 * });
 *
 * server.register("getConfig", () => {
 *   return { apiUrl: "https://api.example.com" };
 * });
 * ```
 */
export class RPCServer<Commands extends RPCCommandDirectory = RPCCommandDirectory> {
  private handlers = new Map<string, RPCHandler<unknown, unknown>>();
  private readonly log: Debugger;

  constructor(name?: string) {
    this.log = logger.extend(name ?? "RPCServer");
  }

  /**
   * Registers a handler function for a command.
   *
   * @param command - The command name (must be defined in Commands)
   * @param handler - The handler function that processes the command
   */
  register<Command extends RPCCommandName<Commands>>(
    command: Command,
    handler: RPCHandler<RPCCommandPayload<Commands, Command>, RPCCommandResult<Commands, Command>>,
  ): void {
    this.handlers.set(command, handler as RPCHandler<unknown, unknown>);
  }

  /**
   * Executes a registered command and returns an Observable of RPC responses.
   *
   * @param id - The request ID for matching responses
   * @param command - The command name
   * @param payload - The command payload
   * @returns An Observable that emits RPCResponse objects
   */
  call(id: string, command: string, payload: unknown): Observable<RPCResponse> {
    this.log("← %s (%s) %o", command, id, payload);
    const handler = this.handlers.get(command);

    if (!handler) {
      this.log("Unknown command: %s (%s)", command, id);
      return of({
        type: "ERROR",
        id,
        error: `Unknown command: ${command}`,
      } satisfies RPCResponseError);
    }

    try {
      const result = handler(payload);
      const result$ = this.normalizeToObservable(result);

      return result$.pipe(
        switchMap((value) => this.convertToResponse(id, command)(of(value))),
        catchError((error) => {
          this.log("→ %s (%s) ERROR %s", command, id, error instanceof Error ? error.message : String(error));
          return of({
            type: "ERROR",
            id,
            error: error instanceof Error ? error.message : String(error),
          } satisfies RPCResponseError);
        }),
      );
    } catch (error) {
      return of({
        type: "ERROR",
        id,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RPCResponseError);
    }
  }

  /**
   * Creates a READY response that can be sent to clients to signal that the server is ready.
   *
   * @returns An RPCResponse of type READY
   */
  ready(): RPCResponseReady {
    this.log("→ READY");
    return {
      type: "READY",
    } satisfies RPCResponseReady;
  }

  /**
   * Converts various return types to an Observable.
   */
  private normalizeToObservable<T>(result: Observable<T> | Promise<T> | Promise<Observable<T>> | T): Observable<T> {
    if (result instanceof Observable) {
      return result;
    }

    if (result instanceof Promise) {
      return from(result).pipe(
        switchMap((value) => {
          // Handle Promise<Observable<T>>
          if (value instanceof Observable) {
            return value;
          }
          // Handle Promise<T>
          return of(value);
        }),
      );
    }

    // Direct value
    return of(result);
  }

  /**
   * Static operator function that converts values to RESULT responses.
   * Catches errors and converts them to ERROR responses.
   *
   * @param id - The request ID
   * @param command - The command name (for logging)
   * @returns An RxJS operator function
   */
  private convertToResponse<T>(id: string, command: string): (source: Observable<T>) => Observable<RPCResponse> {
    return (source: Observable<T>) =>
      source.pipe(
        map((value) => {
          const response = {
            type: "RESULT",
            id,
            value,
          } satisfies RPCResponseResult;
          this.log("→ %s (%s) RESULT %o", command, id, value);
          return response;
        }),
        catchError((error) => {
          this.log("→ %s (%s) ERROR %s", command, id, error instanceof Error ? error.message : String(error));
          return of({
            type: "ERROR",
            id,
            error: error instanceof Error ? error.message : String(error),
          } satisfies RPCResponseError);
        }),
      );
  }
}
