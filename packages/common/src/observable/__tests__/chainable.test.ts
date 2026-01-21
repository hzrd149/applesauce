import { of } from "rxjs";
import { describe, expect, it } from "vitest";
import { chainable, ChainableObservable } from "../chainable.js";

describe("chainable", () => {
  it("should support sync observables", () => {
    const base = of({ value: 10 });
    const chain = chainable(base).value;

    let value = 0;
    chain.subscribe((v) => (value = v));

    expect(value).toBe(10);
  });

  it("should support deep properties", () => {
    const base = of({ first: { second: { value: 10 } } });
    const chain = chainable(base).first.second.value;

    let value = 0;
    chain.subscribe((v) => (value = v));
    expect(value).toBe(10);
  });

  it("should support deep chainable observables", () => {
    const base = of({
      get first$() {
        return of({ value: 10 });
      },
    });
    const chain = chainable(base).first$.value;

    let value = 0;
    chain.subscribe((v) => (value = v));
    expect(value).toBe(10);
  });
});
