import { Observable, Subscriber, Subscription } from "rxjs";

/** The kind of id a relay message is routed by */
export type SocketRouteKind = "sub" | "ok";

/** Gets the route for a NIP-01 relay message, subscription replies by subscription id and OK by event id */
function getRoute(message: any): [SocketRouteKind, string] | undefined {
  if (!Array.isArray(message) || typeof message[1] !== "string") return undefined;

  switch (message[0]) {
    case "EVENT":
    case "EOSE":
    case "CLOSED":
    case "COUNT":
      return ["sub", message[1]];
    case "OK":
      return ["ok", message[1]];
    default:
      return undefined;
  }
}

/**
 * Routes socket messages to the subscribers registered for their id with a single source subscription.
 * Each route behaves like `source.pipe(filter(...))`: it keeps the source subscribed while open and
 * receives the source's error or completion.
 */
export class SocketRouter {
  private routes: Record<SocketRouteKind, Map<string, Set<Subscriber<any>>>> = { sub: new Map(), ok: new Map() };
  private size = 0;
  private subscription: Subscription | null = null;

  constructor(private source: Observable<any>) {}

  /** Returns an observable of the messages routed to an id */
  route(kind: SocketRouteKind, id: string): Observable<any> {
    return new Observable((subscriber) => {
      const routes = this.routes[kind];
      let subscribers = routes.get(id);
      if (!subscribers) routes.set(id, (subscribers = new Set()));
      subscribers.add(subscriber);
      this.size++;

      this.connect();

      return () => {
        if (!subscribers.delete(subscriber)) return;
        if (subscribers.size === 0 && routes.get(id) === subscribers) routes.delete(id);

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
      next: (message) => this.dispatch(message),
      error: (error) => this.terminate((subscriber) => subscriber.error(error)),
      complete: () => this.terminate((subscriber) => subscriber.complete()),
    });

    // The source can error synchronously while subscribing, which already reset the router
    this.subscription = subscription.closed ? null : subscription;
  }

  private dispatch(message: any) {
    const route = getRoute(message);
    if (!route) return;

    const subscribers = this.routes[route[0]].get(route[1]);
    if (!subscribers) return;

    // Iterate a snapshot like an RxJS Subject: subscribers added while dispatching (a synchronous resubscribe
    // after CLOSED) must not receive this message, and subscribers removed while dispatching are skipped
    if (subscribers.size === 1) subscribers.values().next().value!.next(message);
    else for (const subscriber of Array.from(subscribers)) if (subscribers.has(subscriber)) subscriber.next(message);
  }

  private terminate(notify: (subscriber: Subscriber<any>) => void) {
    const subscribers: Subscriber<any>[] = [];
    for (const set of [...this.routes.sub.values(), ...this.routes.ok.values()]) {
      subscribers.push(...set);
      // Clear the old sets so the notified subscribers' teardowns do not touch the new state
      set.clear();
    }

    // Reset before notifying so routes opened by retries resubscribe to the source
    this.routes = { sub: new Map(), ok: new Map() };
    this.size = 0;
    this.subscription = null;

    for (const subscriber of subscribers) notify(subscriber);
  }
}
