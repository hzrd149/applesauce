import type { SyncAuthContext, SyncAuthHandler } from "applesauce-loaders/loaders";
import type { RelayPool } from "applesauce-relay";
import type { ISigner } from "applesauce-signers";
import { BehaviorSubject, defer, finalize, firstValueFrom, Observable, Subscription } from "rxjs";

/** The outcome of one relay in an authentication batch */
export type MessageAuthenticationResult =
  | {
      /** The relay URL */
      url: string;
      /** The successful outcome */
      status: "authenticated";
    }
  | {
      /** The relay URL */
      url: string;
      /** The obsolete or satisfied request */
      status: "skipped";
    }
  | {
      /** The relay URL */
      url: string;
      /** The unsuccessful outcome */
      status: "failed";
      /** The authentication failure */
      error: unknown;
    };

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
type AuthenticationAttempt = {
  controller: AbortController;
  result: Promise<MessageAuthenticationResult>;
  individual?: Promise<void>;
};
const trackers = new WeakMap<SyncAuthHandler, MessageAuthentication>();

/** Tracks account-owned authentication requests without prompting the signer automatically */
export class MessageAuthentication {
  private readonly requests = new BehaviorSubject<readonly MessageAuthRequest[]>([]);

  /** The outstanding requests grouped by relay */
  readonly requests$ = this.requests.asObservable();

  private readonly pending = new Map<symbol, { context: SyncAuthContext; cleanup: Subscription }>();
  private readonly attempts = new Map<string, AuthenticationAttempt>();
  private queue: Promise<unknown> = Promise.resolve();
  private generation = new AbortController();

  /** Creates an authentication tracker for a fixed account */
  constructor(
    private readonly pool: RelayPool,
    private readonly pubkey: string,
    private readonly signer?: ISigner,
    private readonly concurrent = false,
  ) {}

  /** Registers a callback that scoped operations can associate with this tracker */
  configure(options: AuthOptions): AuthOptions {
    const original = options.onAuthRequired;
    const handler: SyncAuthHandler = (context) => original?.(context);
    trackers.set(handler, this);
    return { onAuthRequired: handler, authTimeout: options.authTimeout, waitForAuth: this.pubkey };
  }

  /** The outstanding requests at this moment */
  get currentRequests(): readonly MessageAuthRequest[] {
    return this.requests.value;
  }

  /** Checks whether a relay has an outstanding request */
  hasRequest(url: string): boolean {
    return this.requests.value.some((request) => request.url === url);
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
      const attempt = this.attempts.get(context.url);
      const stillPending = [...this.pending.values()].some((pending) => pending.context.url === context.url);
      if (!authenticated && attempt && !stillPending) attempt.controller.abort();
      this.emit();
    };
    this.pending.set(key, { context, cleanup });
    this.emit();

    const relay = this.pool.relay(context.url);
    // Any matching authentication clears this requirement, including another operation's attempt.
    cleanup.add(
      relay.authenticatedPubkeys$.subscribe((pubkeys) => {
        const required = typeof context.requirement === "string" ? [context.requirement] : context.requirement;
        if (
          Array.isArray(required) ? required.every((pubkey) => pubkeys.includes(pubkey)) : pubkeys.includes(this.pubkey)
        )
          remove(true);
      }),
    );

    // Challenges are display context; approval and operation lifetimes belong to the relay.
    cleanup.add(
      relay.challenge$.subscribe((challenge) => {
        const pending = this.pending.get(key);
        if (!pending || pending.context.challenge === challenge) return;
        pending.context = { ...pending.context, challenge };
        this.emit();
      }),
    );

    // Keep the timeout and relay listeners under the same cleanup subscription.
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
    const request = this.requests.value.find((request) => request.url === url);
    if (!request) return Promise.reject(new Error("No pending authentication request"));
    const attempt = this.enqueue(url);
    return (attempt.individual ??= attempt.result.then((result) => {
      if (result.status === "failed") throw result.error;
      if (result.status === "skipped") throw new Error("Authentication request is no longer pending");
    }));
  }

  /**
   * Authenticates a snapshot of pending relays using the configured concurrency, retaining per-relay failures
   * @throws if clear cancels the batch, including when its client stops or is disposed
   */
  authenticateAll(): Promise<MessageAuthenticationResult[]> {
    const signal = this.generation.signal;
    // Reserve all snapshot entries now so individual clicks share their queued attempts.
    const attempts = this.requests.value.map(({ url }) => this.enqueue(url).result);
    return this.untilAborted(Promise.all(attempts), signal);
  }

  private untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    return new Promise((resolve, reject) => {
      const abort = () => {
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    });
  }

  private enqueue(url: string) {
    const running = this.attempts.get(url);
    if (running && !running.controller.signal.aborted) return running;

    const controller = new AbortController();
    const generation = this.generation.signal;
    const signal = AbortSignal.any([generation, controller.signal]);
    const isCurrent = () => !generation.aborted && this.requests.value.some((request) => request.url === url);
    const update = (state: MessageAuthRequest["state"], error?: unknown) => {
      if (!isCurrent()) return;
      this.requests.next(
        this.requests.value.map((request) => (request.url === url ? { ...request, state, error } : request)),
      );
    };
    const work = (this.concurrent ? Promise.resolve() : this.queue).then(
      async (): Promise<MessageAuthenticationResult> => {
        // Relay cancellation can settle before an extension's non-cancellable signing prompt.
        const signing: Promise<unknown>[] = [];
        try {
          generation.throwIfAborted();
          if (!isCurrent() || signal.aborted) return { url, status: "skipped" };
          const relay = this.pool.relay(url);
          if ((await firstValueFrom(relay.authenticatedPubkeys$)).includes(this.pubkey))
            return { url, status: "skipped" };
          signal.throwIfAborted();
          if (!this.signer) throw new Error("A signer is required");
          const pubkey = await this.signer.getPublicKey();
          if (pubkey !== this.pubkey) throw new Error("Signer does not match message client owner");
          signal.throwIfAborted();
          if (!isCurrent()) return { url, status: "skipped" };
          const response = await relay.authenticate(
            {
              signEvent: (event) => {
                signal.throwIfAborted();
                const signed = this.signer!.signEvent(event);
                signing.push(signed);
                return signed;
              },
            },
            { signal },
          );
          signal.throwIfAborted();
          if (!response.ok) throw new Error(response.message ?? "Relay rejected authentication");
          return { url, status: "authenticated" };
        } catch (error) {
          generation.throwIfAborted();
          if (signal.aborted || !isCurrent()) return { url, status: "skipped" };
          update("failed", error);
          return { url, status: "failed", error };
        } finally {
          await Promise.allSettled(signing);
        }
      },
    );
    // Sequential clients retain their queue until underlying signer work settles, even after clear().
    if (!this.concurrent) this.queue = work.catch(() => {});
    const attempt: AuthenticationAttempt = {
      controller,
      result: this.untilAborted(work, generation),
    };
    attempt.result = attempt.result.finally(() => {
      if (this.attempts.get(url) === attempt) {
        this.attempts.delete(url);
      }
    });
    this.attempts.set(url, attempt);
    update("authenticating");
    return attempt;
  }

  /** Removes all pending requests and their relay subscriptions */
  clear(): void {
    this.generation.abort();
    this.generation = new AbortController();
    this.attempts.clear();
    for (const { cleanup } of this.pending.values()) cleanup.unsubscribe();
    this.pending.clear();
    this.requests.next([]);
  }
}

/**
 * Authenticates relays one at a time, skipping relays whose request was satisfied or released meanwhile
 * @throws if the signal aborts
 */
export async function authenticateSequentially(
  urls: readonly string[],
  isPending: (url: string) => boolean,
  authenticate: (url: string) => Promise<void>,
  signal: AbortSignal,
): Promise<MessageAuthenticationResult[]> {
  const results: MessageAuthenticationResult[] = [];

  for (const url of urls) {
    signal.throwIfAborted();

    if (!isPending(url)) {
      results.push({ url, status: "skipped" });
      continue;
    }

    try {
      await authenticate(url);
      results.push({ url, status: "authenticated" });
    } catch (error) {
      signal.throwIfAborted();
      results.push({ url, status: "failed", error });
    }
  }

  signal.throwIfAborted();
  return results;
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
    // Completion, errors, and unsubscription all release this operation's auth requests.
    return defer(() =>
      operation({ authTimeout: options.authTimeout, waitForAuth: options.waitForAuth, onAuthRequired }),
    ).pipe(finalize(() => cleanup.unsubscribe()));
  });
}
