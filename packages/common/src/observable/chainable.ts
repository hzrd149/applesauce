import { Observable, isObservable, map, of, switchMap } from "rxjs";

/**
 * A symbol used to mark an Observable as chainable
 */
const CHAINABLE_SYMBOL = Symbol.for("chainable-observable");

/**
 * Wraps an Observable in a Proxy that enables property chaining.
 * When accessing a property ending with `$`, it uses switchMap to chain
 * to that property's observable value.
 * When accessing a non-observable property, it returns an Observable of that property's value.
 *
 * @example
 * ```ts
 * const author$ = chainable(note.author$);
 * const outboxes$ = author$.outboxes$; // Observable<string[] | undefined>
 * const displayName$ = author$.displayName; // Observable<string | undefined>
 * ```
 */
export function chainable<T>(observable: Observable<T>): ChainableObservable<T> {
  // If already chainable, return as-is
  if (Reflect.has(observable, CHAINABLE_SYMBOL)) return observable as ChainableObservable<T>;

  // Create a Proxy that intercepts property access
  const proxy = new Proxy(observable, {
    get(target, prop) {
      // Forward all Observable methods and properties
      if (prop in target || typeof prop === "symbol") {
        const value = (target as any)[prop];
        // If it's a function, bind it to the target
        if (typeof value === "function") return value.bind(target);

        return value;
      }

      if (typeof prop === "string") {
        let prop$: Observable<any>;

        // Handle property access for properties ending with $
        if (prop.endsWith("$")) {
          // Use switchMap to chain to the nested observable
          prop$ = target.pipe(
            switchMap((resolved) => {
              const value = (resolved as any)[prop];

              // If value is an observable, return it
              if (isObservable(value)) return value;
              // Otherwise wrap it in an observable
              else return of(value);
            }),
          );
        }
        // For non-$ properties, return an Observable of the property value
        else {
          prop$ = target.pipe(
            // Access the property on the value
            map((resolved) => (resolved as any)[prop]),
          );
          // Make it chainable so you can chain further
          return chainable(prop$) as any;
        }

        // Make the chained observable chainable too
        return chainable(prop$) as any;
      }

      throw new Error(`Unable to access property "${prop}" on chainable observable`);
    },
  }) as any as ChainableObservable<T>;

  // Mark as chainable
  Reflect.set(proxy, CHAINABLE_SYMBOL, true);

  return proxy;
}

/**
 * A chainable Observable type that allows property chaining.
 * This type maps all properties to chainable observables:
 * - Properties ending with $: extracts inner type from Observable<U> → ChainableObservable<U>
 * - Other properties: uses property type directly → ChainableObservable<PropertyType>
 *
 * Note: TypeScript has limitations inferring through Proxy types. For better
 * type inference, you may need to explicitly type the result:
 *
 * @example
 * ```ts
 * const inboxes$: Observable<string[] | undefined> = note?.author$.inboxes$;
 * const displayName$: Observable<string | undefined> = note?.author$.displayName;
 * const inboxes = useObservableMemo(() => inboxes$, [note]);
 * ```
 */
export type ChainableObservable<T> = Observable<T> & {
  [K in keyof T as K extends string ? K : never]: K extends `${infer _}$`
    ? T[K] extends Observable<infer U>
      ? ChainableObservable<U>
      : never
    : ChainableObservable<T[K]>;
};
