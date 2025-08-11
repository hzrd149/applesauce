// Simple types copied from rxjs

export interface Unsubscribable {
  unsubscribe(): void;
}
export interface Observer<T> {
  next: (value: T) => void;
  error: (err: any) => void;
  complete: () => void;
}
export type Subscribable<T extends unknown> = {
  subscribe: (observer: Partial<Observer<T>>) => Unsubscribable;
};
