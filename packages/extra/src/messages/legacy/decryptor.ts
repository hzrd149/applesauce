import { logger } from "applesauce-core";
import { isValidLegacyMessage, unlockLegacyMessage } from "applesauce-common/helpers";
import {
  isEncryptedContentFromCache,
  isEncryptedContentUnlocked,
  isPTag,
  restoreEncryptedContent,
  saveEncryptedContent,
  type EncryptedContentCache,
  type NostrEvent,
} from "applesauce-core/helpers";
import { isNIP04Encrypted } from "applesauce-core/helpers/encryption";
import type { ISigner } from "applesauce-signers";
import {
  BehaviorSubject,
  catchError,
  combineLatest,
  concatMap,
  defer,
  distinctUntilChanged,
  EMPTY,
  filter,
  finalize,
  firstValueFrom,
  fromEvent,
  map,
  type Observable,
  of,
  switchMap,
  takeUntil,
  tap,
  timeout,
  TimeoutError,
} from "rxjs";
import type { LegacyDecryptionState, LegacyMessageFailure, LegacyReadResult, LegacyReceiverError } from "./types.js";

const log = logger.extend("LegacyMessages");

type DecryptionActivity = { readers: number; attempts: number; failure?: LegacyMessageFailure };

/** Dependencies for a shared NIP-04 decryptor */
export interface LegacyMessageDecryptorOptions {
  /** The immutable owner pubkey */
  pubkey: string;
  /** The NIP-04 signer, omitted for cache-only processing */
  signer?: ISigner;
  /** The plaintext cache keyed by kind-4 event ID */
  decryptionCache?: EncryptedContentCache;
  /** The timeout for one decryption including its signer queue wait, in milliseconds (default 60000) */
  decryptionTimeout?: number;
}

/** Classifies a decryption error into a stable failure */
function classifyFailure(event: NostrEvent, cause: unknown, attempts: number): LegacyMessageFailure {
  if (cause instanceof TimeoutError) return { eventId: event.id, code: "timeout", cause, attempts, retry: "manual" };
  if (!isNIP04Encrypted(event.content))
    return { eventId: event.id, code: "invalid-message", cause, attempts, retry: "never" };
  if (cause instanceof Error && cause.message === "A signer is required")
    return { eventId: event.id, code: "signer-unavailable", cause, attempts, retry: "manual" };

  return { eventId: event.id, code: "decryption-failed", cause, attempts, retry: "manual" };
}

/** An account-scoped NIP-04 decryptor shared by inbox and conversation receivers so each event is decrypted once */
export class LegacyMessageDecryptor {
  /** The immutable owner pubkey */
  readonly pubkey: string;

  private readonly activity = new BehaviorSubject<ReadonlyMap<string, DecryptionActivity>>(new Map());
  private readonly pendingDecryptions = new Map<string, Promise<NostrEvent | undefined>>();
  private signerQueue: Promise<void> = Promise.resolve();

  /** Creates a decryptor for one account */
  constructor(private readonly options: LegacyMessageDecryptorOptions) {
    this.pubkey = options.pubkey;
  }

  private get decryptionTimeout() {
    return this.options.decryptionTimeout ?? 60000;
  }

  private updateActivity(event: NostrEvent, change: (previous: DecryptionActivity) => DecryptionActivity) {
    const next = new Map(this.activity.value);
    const updated = change(next.get(event.id) ?? { readers: 0, attempts: 0 });

    if (!updated.readers && !updated.failure) next.delete(event.id);
    else next.set(event.id, updated);

    this.activity.next(next);
  }

  private hasReaders(event: NostrEvent) {
    return !!this.activity.value.get(event.id)?.readers;
  }

  /** Restores cached plaintext without prompting the signer, logging cache failures */
  async restore(event: NostrEvent): Promise<void> {
    if (!this.options.decryptionCache || isEncryptedContentUnlocked(event)) return;

    await restoreEncryptedContent(event, this.options.decryptionCache).catch((error) => {
      log("Failed to restore encrypted content for %s", event.id, error);
    });
  }

  private async decrypt(event: NostrEvent) {
    await this.restore(event);

    // Cache reads cannot be cancelled, but abandoned readers must not prompt the signer afterward.
    if (!this.hasReaders(event)) return undefined;

    if (!isEncryptedContentUnlocked(event)) {
      if (!isNIP04Encrypted(event.content)) throw new Error("Invalid NIP-04 encrypted message content");

      const unlocking = this.signerQueue.then(async () => {
        // Readers may leave while waiting behind another event's signer prompt.
        if (!this.hasReaders(event) || isEncryptedContentUnlocked(event)) return;
        if (!this.options.signer) throw new Error("A signer is required");

        await unlockLegacyMessage(event, this.pubkey, this.options.signer);
      });

      // Keep the queue usable after a rejection, and occupied until the signer actually settles.
      this.signerQueue = unlocking.catch(() => undefined);
      await unlocking;

      if (!isEncryptedContentUnlocked(event)) return undefined;
    }

    if (this.options.decryptionCache && !isEncryptedContentFromCache(event)) {
      await saveEncryptedContent(event, this.options.decryptionCache).catch((error) => {
        log("Failed to persist encrypted content for %s", event.id, error);
      });
    }

    return event;
  }

  /** Checks whether an event belongs to the owner's mailboxes */
  isOwnMessage(event: NostrEvent): boolean {
    if (!isValidLegacyMessage(event)) return false;
    if (event.pubkey === this.pubkey) return true;

    return event.tags.some((tag) => isPTag(tag) && tag[1] === this.pubkey);
  }

  /** Decrypts an owned message, sharing one signer call between concurrent readers */
  read$(event: NostrEvent): Observable<NostrEvent> {
    return defer(() => {
      if (!this.isOwnMessage(event)) return EMPTY;

      let decryption = this.pendingDecryptions.get(event.id);
      const started = !decryption;
      if (!decryption) {
        decryption = this.decrypt(event);
        this.pendingDecryptions.set(event.id, decryption);

        // A timed-out or cancelled reader must still share an unresolved signer call.
        const release = () => this.pendingDecryptions.delete(event.id);
        void decryption.then(release, release);
      }

      this.updateActivity(event, (previous) => ({
        ...previous,
        readers: previous.readers + 1,
        attempts: started ? previous.attempts + 1 : previous.attempts,
      }));

      const recordFailure = (error: unknown) => {
        this.updateActivity(event, (previous) => ({
          ...previous,
          failure: classifyFailure(event, error, previous.attempts),
        }));
      };

      return defer(() => decryption).pipe(
        filter((message): message is NostrEvent => message !== undefined),
        timeout({ first: this.decryptionTimeout }),
        tap({
          next: () => this.updateActivity(event, (previous) => ({ ...previous, failure: undefined })),
          error: recordFailure,
        }),
        finalize(() => this.updateActivity(event, (previous) => ({ ...previous, readers: previous.readers - 1 }))),
      );
    });
  }

  /**
   * Decrypts one event and returns it once plaintext is available
   * @throws if decryption fails or the signal aborts
   */
  async unlock(event: NostrEvent, signal: AbortSignal): Promise<NostrEvent | undefined> {
    const message = await firstValueFrom(this.read$(event).pipe(takeUntil(fromEvent(signal, "abort"))), {
      defaultValue: undefined,
    });
    signal.throwIfAborted();

    return message;
  }

  /**
   * Decrypts each event without a previous failure, ignoring individual failures
   * @throws if the signal aborts
   */
  async unlockAll(events: Iterable<NostrEvent>, signal: AbortSignal): Promise<void> {
    for (const event of [...events]) {
      signal.throwIfAborted();
      if (!this.shouldUnlock(event)) continue;

      try {
        await this.unlock(event, signal);
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
  }

  /**
   * Decrypts one event and returns its outcome instead of throwing on failure
   * @throws if the signal aborts
   */
  async readResult(event: NostrEvent, signal: AbortSignal): Promise<LegacyReadResult> {
    try {
      if (!isValidLegacyMessage(event)) throw new Error("Invalid NIP-04 message");

      const message = await this.unlock(event, signal);
      if (message && isEncryptedContentUnlocked(message)) return { status: "success", event: message };

      throw new Error("Decryption ended without plaintext");
    } catch (cause) {
      signal.throwIfAborted();

      // Record failures that never reached read$ so they are not attempted again.
      if (!this.failure(event.id)) {
        this.updateActivity(event, (previous) => ({
          ...previous,
          failure: classifyFailure(event, cause, Math.max(1, previous.attempts)),
        }));
      }

      return { status: "failed", event, failure: this.failure(event.id)! };
    }
  }

  /**
   * Decrypts the first eligible event that no other reader is processing
   * @returns the outcome, or undefined when no eligible event remains
   * @throws if the signal aborts
   */
  async readNext(events: Iterable<NostrEvent>, signal: AbortSignal): Promise<LegacyReadResult | undefined> {
    for (const event of events) {
      signal.throwIfAborted();
      if (!this.shouldUnlock(event) || this.hasReaders(event)) continue;

      return this.readResult(event, signal);
    }

    return undefined;
  }

  /** Clears a recorded failure so the event becomes eligible again */
  clearFailure(eventId: string): void {
    const activity = this.activity.value.get(eventId);
    if (!activity?.failure) return;

    const next = new Map(this.activity.value);
    if (activity.readers) next.set(eventId, { ...activity, failure: undefined });
    else next.delete(eventId);

    this.activity.next(next);
  }

  /** Returns the recorded failure of an event */
  failure(eventId: string): LegacyMessageFailure | undefined {
    return this.activity.value.get(eventId)?.failure;
  }

  /** Returns the IDs of all events with a recorded failure */
  failedEventIds(): string[] {
    return [...this.activity.value].filter(([, activity]) => activity.failure).map(([eventId]) => eventId);
  }

  /** Checks whether an event needs an automatic or bulk decryption attempt */
  shouldUnlock(event: NostrEvent): boolean {
    return !isEncryptedContentUnlocked(event) && !this.failure(event.id);
  }

  /** Derives decryption counts for a set of loaded messages */
  observeState$(messages$: Observable<NostrEvent[]>): Observable<LegacyDecryptionState> {
    return combineLatest([messages$, this.activity]).pipe(
      map(([events, activity]) => {
        let unlocked = 0;
        let pending = 0;
        const errors = new Map<string, unknown>();

        for (const event of events) {
          // Plaintext from any route takes precedence over an earlier failed attempt.
          if (isEncryptedContentUnlocked(event)) {
            unlocked++;
            continue;
          }

          const current = activity.get(event.id);
          if (current && current.readers > 0) pending++;
          if (current?.failure) errors.set(event.id, current.failure.cause);
        }

        return { total: events.length, unlocked, locked: events.length - unlocked, pending, errors };
      }),
    );
  }

  private processEvent$(
    event: NostrEvent,
    autoUnlock: boolean,
    onError?: (error: LegacyReceiverError) => void,
  ): Observable<LegacyReadResult> {
    if (autoUnlock && this.shouldUnlock(event)) {
      return this.read$(event).pipe(
        map((message): LegacyReadResult => ({ status: "success", event: message })),
        catchError((error) => {
          const failure = this.failure(event.id);
          onError?.({ operation: "decrypt", error, eventId: event.id, failure });

          return failure ? of<LegacyReadResult>({ status: "failed", event, failure }) : EMPTY;
        }),
      );
    }

    const restore$ = defer(() => this.restore(event)).pipe(timeout({ first: this.decryptionTimeout }));

    return restore$.pipe(
      switchMap(() => (isEncryptedContentUnlocked(event) ? of<LegacyReadResult>({ status: "success", event }) : EMPTY)),
      catchError((error) => {
        onError?.({ operation: "cache", error, eventId: event.id });
        return EMPTY;
      }),
    );
  }

  /** Restores cached plaintext and optionally decrypts stored arrivals in order */
  process$(
    events$: Observable<NostrEvent>,
    autoUnlock$: Observable<boolean>,
    onError?: (error: LegacyReceiverError) => void,
  ): Observable<LegacyReadResult> {
    return autoUnlock$.pipe(
      distinctUntilChanged(),
      // Replacing the stream drops queued work; already-running signer promises remain shared.
      switchMap((autoUnlock) => events$.pipe(concatMap((event) => this.processEvent$(event, autoUnlock, onError)))),
    );
  }
}
