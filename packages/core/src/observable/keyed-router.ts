import { Observable, Subscriber, Subscription } from "rxjs";

/**
 * Routes values from a source to the subscribers registered for their key with a single source subscription.
 * Each route behaves like `source.pipe(filter((v) => key(v) === k))`, including the source's error and completion.
 */
export class KeyedRouter<T> {
  private routes = new Map<string, Set<Subscriber<T>>>();
  private size = 0;
  private subscription: Subscription | null = null;

  constructor(
    private source: Observable<T>,
    private key: (value: T) => string,
  ) {}

  /** Returns an observable of the values routed to a key */
  route(key: string): Observable<T> {
    return new Observable<T>((subscriber) => {
      let subscribers = this.routes.get(key);
      if (!subscribers) this.routes.set(key, (subscribers = new Set()));
      subscribers.add(subscriber);
      this.size++;

      this.connect();

      return () => {
        if (!subscribers.delete(subscriber)) return;
        if (subscribers.size === 0 && this.routes.get(key) === subscribers) this.routes.delete(key);

        if (--this.size === 0) {
          this.subscription?.unsubscribe();
          this.subscription = null;
        }
      };
    });
  }

  private connect() {
    if (this.subscription) return;

    const subscription = this.source.subscribe({
      next: (value) => this.dispatch(value),
      error: (error) => this.terminate((subscriber) => subscriber.error(error)),
      complete: () => this.terminate((subscriber) => subscriber.complete()),
    });

    // The source can error or complete synchronously while subscribing, which already reset the router
    this.subscription = subscription.closed ? null : subscription;
  }

  private dispatch(value: T) {
    const subscribers = this.routes.get(this.key(value));
    if (!subscribers) return;

    // Iterate a snapshot like an RxJS Subject: subscribers added while dispatching do not receive
    // this value, and subscribers removed while dispatching are skipped
    if (subscribers.size === 1) subscribers.values().next().value!.next(value);
    else for (const subscriber of Array.from(subscribers)) if (subscribers.has(subscriber)) subscriber.next(value);
  }

  private terminate(notify: (subscriber: Subscriber<T>) => void) {
    const subscribers: Subscriber<T>[] = [];
    for (const set of this.routes.values()) {
      subscribers.push(...set);
      // Clear the old sets so the notified subscribers' teardowns do not touch the new state
      set.clear();
    }

    // Reset before notifying so routes opened while notifying resubscribe to the source
    this.routes = new Map();
    this.size = 0;
    this.subscription = null;

    for (const subscriber of subscribers) notify(subscriber);
  }
}

// One router per source and key type, so every model on a store shares the same source subscription
const routers = new WeakMap<Observable<any>, Map<string, KeyedRouter<any>>>();

/** Gets the shared {@link KeyedRouter} for a source and a named key function */
export function getKeyedRouter<T>(source: Observable<T>, name: string, key: (value: T) => string): KeyedRouter<T> {
  let named = routers.get(source);
  if (!named) routers.set(source, (named = new Map()));

  let router = named.get(name);
  if (!router) named.set(name, (router = new KeyedRouter(source, key)));
  return router;
}
