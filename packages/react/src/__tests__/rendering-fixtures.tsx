import { Observable, Subscriber } from "rxjs";

export function createControlledObservable<T>() {
  let subscriber: Subscriber<T> | undefined;
  const observable = new Observable<T>((next) => {
    subscriber = next;
  });

  return {
    observable,
    next(value: T) {
      subscriber?.next(value);
    },
  };
}
