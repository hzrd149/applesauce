export function getCachedValue<T extends unknown>(event: any, symbol: symbol): T | undefined {
  return Reflect.get(event, symbol);
}

export function setCachedValue<T extends unknown>(event: any, symbol: symbol, value: T) {
  Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true });
}

/** Internal method used to cache computed values on events */
export function getOrComputeCachedValue<T extends unknown>(event: any, symbol: symbol, compute: () => T): T {
  if (Reflect.has(event, symbol)) {
    return Reflect.get(event, symbol);
  } else {
    const value = compute();
    Object.defineProperty(event, symbol, { value, enumerable: false, writable: true, configurable: true });
    return value;
  }
}
