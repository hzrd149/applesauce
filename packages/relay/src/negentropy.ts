import { IAsyncEventStoreRead, IEventStoreRead, logger } from "applesauce-core";
import { type Filter } from "applesauce-core/helpers";
import { nanoid } from "nanoid";
import { concatMap, concatWith, defer, EMPTY, finalize, from, map, Observable, share, switchMap, takeUntil, takeWhile, throwError } from "rxjs";

import { Negentropy, NegentropyStorageVector } from "./lib/negentropy.js";
import { MultiplexWebSocket, NegentropyOptions, NegentropyRound } from "./types.js";

/**
 * A function that reconciles the storage vectors with a remote relay
 * @param have - The ids that the local storage has
 * @param need - The ids that the remote relay has
 * @returns A promise that resolves when the reconciliation is complete
 */
export type { NegentropyOptions, NegentropyRound } from "./types.js";

const log = logger.extend("negentropy");

/**
 * Thrown when the relay responds to a negentropy negotiation with a NEG-ERR message.
 * The `reason` follows the NIP-01 machine-readable prefix format (e.g. `auth-required: ...`),
 * allowing the relay layer to map it to a typed error and drive the auth-retry flow.
 */
export class NegentropyError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "NegentropyError";
  }
}

/** Creates a NegentropyStorageVector from an event store and filter */
export async function buildStorageFromFilter(
  store: IEventStoreRead | IAsyncEventStoreRead,
  filter: Filter,
): Promise<NegentropyStorageVector> {
  const storage = new NegentropyStorageVector();
  for (const event of await store.getByFilters(filter)) storage.insert(event.created_at, event.id);
  storage.seal();
  return storage;
}

/** Creates a NegentropyStorageVector from an array of items */
export function buildStorageVector(items: { id: string; created_at: number }[]): NegentropyStorageVector {
  const storage = new NegentropyStorageVector();
  for (const item of items) storage.insert(item.created_at, item.id);
  storage.seal();
  return storage;
}

/**
 * Sync the storage vectors with a remote relay
 * @throws {Error} if the sync fails
 * @returns true if the sync was successful, false if the sync was aborted
 */
export function negentropySync(
  storage: NegentropyStorageVector,
  socket: MultiplexWebSocket & { next: (msg: any) => void },
  filter: Filter,
  opts?: NegentropyOptions,
): Observable<NegentropyRound> {
  const id = opts?.id ?? nanoid();
  const abort$ = new Observable<void>((subscriber) => {
    if (!opts?.signal) return;
    if (opts.signal.aborted) {
      subscriber.next();
      subscriber.complete();
      return;
    }
    const abort = () => {
      subscriber.next();
      subscriber.complete();
    };
    opts.signal.addEventListener("abort", abort);
    return () => opts.signal?.removeEventListener("abort", abort);
  });

  return defer(() => {
    if (opts?.signal?.aborted) return EMPTY;
    const state = new Negentropy(storage, opts?.frameSizeLimit);
    let terminalRoundSeen = false;
    return from(state.initiate<string>()).pipe(
      switchMap((initial) =>
        socket
          .multiplex(
            () => {
              log("Sending initial message", id, filter, initial);
              return ["NEG-OPEN", id, filter, initial];
            },
            () => {
              log("Closing sync", id);
              return ["NEG-CLOSE", id];
            },
            (message) => (message[0] === "NEG-MSG" || message[0] === "NEG-ERR") && message[1] === id,
          )
          .pipe(
            map((message) => {
              if (message[0] === "NEG-ERR") throw new NegentropyError(message[2]);
              return message[2] as string;
            }),
            concatMap(async (message) => {
              const [followUp, have, need] = await state.reconcile<string>(message);
              if (followUp === null) terminalRoundSeen = true;
              if (followUp !== null) socket.next(["NEG-MSG", id, followUp]);
              return { followUp, round: { have, need } };
            }),
            takeWhile(({ followUp }) => followUp !== null, true),
            map(({ round }) => round),
            concatWith(
              defer(() =>
                terminalRoundSeen
                  ? EMPTY
                  : throwError(() => new NegentropyError("error: negotiation completed before terminal round")),
              ),
            ),
            takeUntil(abort$),
          ),
      ),
      finalize(() => log("Finished sync", id)),
    );
  }).pipe(share());
}
