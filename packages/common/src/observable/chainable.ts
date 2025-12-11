import { Observable, switchMap } from "rxjs";

/**
 * A symbol used to mark an Observable as chainable
 */
const CHAINABLE_SYMBOL = Symbol.for("chainable-observable");

/**
 * Wraps an Observable in a Proxy that enables property chaining.
 * When accessing a property ending with `$`, it uses switchMap to chain
 * to that property's observable value.
 *
 * @example
 * ```ts
 * const author$ = chainable(note.author$);
 * const outboxes$ = author$.outboxes$; // Observable<string[] | undefined>
 * ```
 */
export function chainable<T>(observable: Observable<T>): ChainableObservable<T> {
  // If already chainable, return as-is
  if (Reflect.has(observable, CHAINABLE_SYMBOL)) {
    return observable as ChainableObservable<T>;
  }

  // Create a Proxy that intercepts property access
  const proxy = new Proxy(observable, {
    get(target, prop: string | symbol) {
      // Forward all Observable methods and properties
      if (prop in target || typeof prop === "symbol") {
        const value = (target as any)[prop];
        // If it's a function, bind it to the target
        if (typeof value === "function") {
          return value.bind(target);
        }
        return value;
      }

      // Handle property access for properties ending with $
      if (typeof prop === "string" && prop.endsWith("$")) {
        // Use switchMap to chain to the nested observable
        const chained = target.pipe(
          switchMap((value) => {
            // Access the property on the value
            const nestedObservable = (value as any)?.[prop];
            if (nestedObservable instanceof Observable) {
              return nestedObservable;
            }
            // If the property doesn't exist or isn't an Observable, return empty
            return new Observable((subscriber) => {
              subscriber.complete();
            });
          }),
        );
        // Make the chained observable chainable too
        return chainable(chained) as any;
      }

      // For non-$ properties, return undefined (or you could throw an error)
      return undefined;
    },
  }) as any as ChainableObservable<T>;

  // Mark as chainable
  Reflect.set(proxy, CHAINABLE_SYMBOL, true);

  return proxy;
}

/** Extracts observable properties (ending with $) from a type */
export type ObservableProperties<T> = {
  [K in keyof T as K extends string ? (K extends `${infer _}$` ? K : never) : never]: T[K];
};

/**
 * A chainable Observable type that allows property chaining.
 * This type explicitly maps observable properties to chainable observables.
 *
 * Note: TypeScript has limitations inferring through Proxy types. For better
 * type inference, you may need to explicitly type the result:
 *
 * @example
 * ```ts
 * const inboxes$: Observable<string[] | undefined> = note?.author$.inboxes$;
 * const inboxes = useObservableMemo(() => inboxes$, [note]);
 * ```
 */
export type ChainableObservable<T> = Observable<T> & {
  [K in keyof ObservableProperties<T>]: ObservableProperties<T>[K] extends Observable<infer U>
    ? ChainableObservable<U>
    : never;
};

/**
 * Helper type to extract the value type from a chainable observable property.
 * This can help with type inference when TypeScript can't infer through Proxy.
 *
 * @example
 * ```ts
 * type InboxesType = ChainableValue<typeof note.author$.inboxes$>; // string[] | undefined
 * ```
 */
export type ChainableValue<T> = T extends ChainableObservable<infer U> ? U : T extends Observable<infer U> ? U : never;
