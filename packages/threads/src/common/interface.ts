/**
 * Base interface for RPC command directories.
 * Extend this interface to define your command types.
 */
export interface RPCCommandDirectory {
  [command: string]: {
    payload: unknown;
    result: unknown;
  };
}

/**
 * Outgoing message types (Client → Worker)
 */
export type RPCMessage =
  | {
      type: "CALL";
      id: string;
      command: string;
      payload: unknown;
    }
  | {
      type: "CLOSE";
      id: string;
    };

/**
 * Incoming message types (Worker → Client)
 */
export type RPCResponse =
  | {
      type: "RESULT";
      id: string;
      value: unknown;
    }
  | {
      type: "ERROR";
      id: string;
      error: string;
    }
  | {
      type: "COMPLETE";
      id: string;
    }
  | {
      type: "READY";
    };

/**
 * Type helpers for extracting command types
 */
export type RPCCommandName<Commands extends RPCCommandDirectory> = keyof Commands & string;

export type RPCCommandPayload<
  Commands extends RPCCommandDirectory,
  Command extends RPCCommandName<Commands>,
> = Commands[Command]["payload"];

export type RPCCommandResult<
  Commands extends RPCCommandDirectory,
  Command extends RPCCommandName<Commands>,
> = Commands[Command]["result"];

/**
 * Specific response types for type safety
 */
export type RPCResponseResult = Extract<RPCResponse, { type: "RESULT" }>;
export type RPCResponseError = Extract<RPCResponse, { type: "ERROR" }>;
export type RPCResponseComplete = Extract<RPCResponse, { type: "COMPLETE" }>;
export type RPCResponseReady = Extract<RPCResponse, { type: "READY" }>;
