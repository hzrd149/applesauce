import { Observable, filter, firstValueFrom, isObservable, lastValueFrom, map, of, switchMap, timeout } from "rxjs";

/**
 * A symbol used to mark an Observable as chainable
 */
const CHAINABLE_SYMBOL = Symbol.for("chainable-observable");
const CHAINABLE_CACHE_SYMBOL = Symbol.for("chainable-cache");

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
    get(target$, prop) {
      const cache: Record<string, ChainableObservable<any>> = (observable as any)[CHAINABLE_CACHE_SYMBOL] ||
      ((observable as any)[CHAINABLE_CACHE_SYMBOL] = {});

      // Forward all Observable methods and properties
      if (prop in target$ || typeof prop === "symbol") {
        const value = (target$ as any)[prop];
        // If it's a function, bind it to the target
        if (typeof value === "function") return value.bind(target$);

        return value;
      }

      if (typeof prop === "string") {
        // Return cached observable if it exists
        const cached = cache[prop];
        if (cached) return cached;

        // Otherwise, create a new observable
        let prop$: Observable<any>;

        // Extra observalbe helpers to make it easier to work with observables
        if (prop === "$first") {
          return (wait: number = 30_000) =>
            firstValueFrom(
              target$.pipe(
                filter((v) => v !== undefined && v !== null),
                timeout({ first: wait }),
              ),
            );
        } else if (prop === "$last") {
          return (wait: number = 30_000) =>
            lastValueFrom(
              target$.pipe(
                filter((v) => v !== undefined && v !== null),
                timeout({ first: wait }),
              ),
            );
        }
        // Handle property access for properties ending with $
        else if (prop.endsWith("$")) {
          // Use switchMap to chain to the nested observable
          prop$ = target$.pipe(
            switchMap((target) => {
              const value = target === undefined || target === null ? target : target[prop as keyof T];

              // If value is an observable, return it
              if (isObservable(value)) return value;
              // Otherwise wrap it in an observable
              else return of(value);
            }),
          );
        }
        // For non-$ properties, return an Observable of the property value
        else {
          prop$ = target$.pipe(
            // Access the property on the value if target is not undefined or null
            map((target) => (target === undefined || target === null ? target : target[prop as keyof T])),
          );
        }

        // Make the chained observable chainable too
        const observable = chainable(prop$) as any;
        cache[prop] = observable;
        return observable;
      }

      throw new Error(`Unable to access property "${prop}" on chainable observable`);
    },
  }) as any as ChainableObservable<T>;

  // Mark as chainable
  Reflect.set(proxy, CHAINABLE_SYMBOL, true);

  return proxy;
}

/**
 * Helper type to extract nullable parts (undefined/null) from a type
 */
type NullableParts<T> = Extract<T, undefined | null>;

/**
 * Helper type to get the property type, preserving nullable parts from the parent type
 */
type PropChain<T, K extends keyof NonNullable<T>> = NonNullable<T>[K] | NullableParts<T>;

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
export type ChainableObservable<T> = Observable<T> &
  Omit<
    {
      [K in keyof NonNullable<T> as K extends string ? K : never]: K extends `${infer _}$`
        ? NonNullable<T>[K] extends Observable<infer U>
          ? ChainableObservable<U | NullableParts<T>>
          : never
        : ChainableObservable<PropChain<T, K>>;
    },
    "$first" | "$last"
  > & {
    /** Returns a promise that resolves with the first value or rejects with a timeout error */
    $first(first?: number): Promise<NonNullable<T>>;
    /** Returns a promise that resolves with the last value or rejects with a timeout error */
    $last(max?: number): Promise<NonNullable<T>>;
  };
