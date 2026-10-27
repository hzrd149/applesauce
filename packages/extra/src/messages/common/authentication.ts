import type { SyncAuthContext, SyncAuthHandler } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { BehaviorSubject, defer, finalize, Observable, Subscription } from "rxjs";

/** A relay authentication request awaiting user action */
export interface MessageAuthRequest {
  /** The relay URL */
  url: string;
  /** The latest authentication requirement */
  context: SyncAuthContext;
  /** The current authentication attempt state */
  state: "pending" | "authenticating" | "failed";
  /** The most recent authentication failure */
  error?: unknown;
}

type AuthOptions = { onAuthRequired?: SyncAuthHandler; authTimeout?: number | false; waitForAuth?: string };
const trackers = new WeakMap<SyncAuthHandler, MessageAuthentication>();

/** Tracks account-owned authentication requests without prompting the signer automatically */
export class MessageAuthentication {
  private readonly requests = new BehaviorSubject<readonly MessageAuthRequest[]>([]);
  /** The outstanding requests grouped by relay */
  readonly requests$ = this.requests.asObservable();
  private readonly pending = new Map<symbol, { context: SyncAuthContext; cleanup: Subscription }>();
  private readonly attempts = new Map<string, Promise<void>>();
  private readonly controllers = new Map<string, AbortController>();
  private generation = new AbortController();

  /** Creates an authentication tracker for a fixed account */
  constructor(
    private readonly pool: RelayPool,
    private readonly pubkey: string,
    private readonly signer?: ISigner,
  ) {}

  /** Registers a callback that scoped operations can associate with this tracker */
  configure(options: AuthOptions): AuthOptions {
    const original = options.onAuthRequired;
    const handler: SyncAuthHandler = (context) => original?.(context);
    trackers.set(handler, this);
    return { onAuthRequired: handler, authTimeout: options.authTimeout, waitForAuth: this.pubkey };
  }

  /** Tracks one operation's requirement until it is satisfied or released */
  track(context: SyncAuthContext, timeout: number | false = 30000, onSettled?: () => void): () => void {
    const key = Symbol();
    const cleanup = new Subscription();
    cleanup.add(() => onSettled?.());
    const remove = (authenticated = false) => {
      if (!this.pending.has(key)) return;
      this.pending.delete(key);
      cleanup.unsubscribe();
      if (!authenticated && ![...this.pending.values()].some((pending) => pending.context.url === context.url))
        this.controllers.get(context.url)?.abort();
      this.emit();
    };
    this.pending.set(key, { context, cleanup });
    this.emit();
    const relay = this.pool.relay(context.url);
    cleanup.add(
      relay.authenticatedPubkeys$.subscribe((pubkeys) => {
        const required = typeof context.requirement === "string" ? [context.requirement] : context.requirement;
        if (
          Array.isArray(required) ? required.every((pubkey) => pubkeys.includes(pubkey)) : pubkeys.includes(this.pubkey)
        )
          remove(true);
      }),
    );
    let currentChallenge = context.challenge;
    cleanup.add(
      relay.challenge$.subscribe((challenge) => {
        if (currentChallenge !== null && challenge !== currentChallenge) remove();
        currentChallenge = challenge;
      }),
    );
    if (timeout !== false) {
      const timer = setTimeout(() => remove(), timeout);
      cleanup.add(() => clearTimeout(timer));
    }
    return () => remove();
  }

  private emit() {
    const previous = new Map(this.requests.value.map((request) => [request.url, request]));
    const contexts = new Map([...this.pending.values()].map(({ context }) => [context.url, context]));
    this.requests.next(
      [...contexts].map(([url, context]) => ({
        ...previous.get(url),
        url,
        context,
        state: previous.get(url)?.state ?? "pending",
      })),
    );
  }

  /**
   * Authenticates a pending relay with the account signer
   * @throws if no request or matching signer exists, authentication fails, or the operation is cancelled
   */
  authenticate(url: string): Promise<void> {
    const running = this.attempts.get(url);
    if (running) return running;
    const controller = new AbortController();
    this.controllers.set(url, controller);
    const signal = AbortSignal.any([this.generation.signal, controller.signal]);
    const attempt = Promise.resolve()
      .then(async () => {
        signal.throwIfAborted();
        if (!this.requests.value.some((request) => request.url === url))
          throw new Error("No pending authentication request");
        if (!this.signer) throw new Error("A signer is required");
        if ((await this.signer.getPublicKey()) !== this.pubkey)
          throw new Error("Signer does not match message client owner");
        signal.throwIfAborted();
        const response = await this.pool.relay(url).authenticate(this.signer, { signal });
        signal.throwIfAborted();
        if (!response.ok) throw new Error(response.message ?? "Relay rejected authentication");
      })
      .catch((error) => {
        if (!signal.aborted)
          this.requests.next(
            this.requests.value.map((request) =>
              request.url === url ? { ...request, state: "failed", error } : request,
            ),
          );
        throw error;
      })
      .finally(() => {
        if (this.attempts.get(url) === attempt) {
          this.attempts.delete(url);
          this.controllers.delete(url);
        }
      });
    this.attempts.set(url, attempt);
    this.requests.next(
      this.requests.value.map((request) =>
        request.url === url ? { ...request, state: "authenticating", error: undefined } : request,
      ),
    );
    return attempt;
  }

  /** Removes all pending requests and their relay subscriptions */
  clear(): void {
    this.generation.abort();
    this.generation = new AbortController();
    this.attempts.clear();
    this.controllers.clear();
    for (const { cleanup } of this.pending.values()) cleanup.unsubscribe();
    this.pending.clear();
    this.requests.next([]);
  }
}

/** Scopes authentication requests to a subscribed operation's lifetime */
export function withMessageAuth$<T>(
  options: AuthOptions,
  operation: (options: AuthOptions) => Observable<T>,
  signal?: AbortSignal,
): Observable<T> {
  return defer(() => {
    signal?.throwIfAborted();
    const cleanup = new Subscription();
    const abort = () => cleanup.unsubscribe();
    signal?.addEventListener("abort", abort, { once: true });
    cleanup.add(() => signal?.removeEventListener("abort", abort));
    const tracker = options.onAuthRequired && trackers.get(options.onAuthRequired);
    const onAuthRequired: SyncAuthHandler = async (context) => {
      if (cleanup.closed) return;
      const settled = tracker
        ? new Promise<void>((resolve) => cleanup.add(tracker.track(context, options.authTimeout, resolve)))
        : undefined;
      await options.onAuthRequired?.(context);
      await settled;
    };
    return defer(() =>
      operation({ authTimeout: options.authTimeout, waitForAuth: options.waitForAuth, onAuthRequired }),
    ).pipe(finalize(() => cleanup.unsubscribe()));
  });
}
