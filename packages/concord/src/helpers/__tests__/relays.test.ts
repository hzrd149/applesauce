import { BehaviorSubject, Subject } from "rxjs";
import { describe, expect, it } from "vitest";

import { ExtraRelays, sameRelaySet, toRelaysObservable } from "../relays.js";

// Bare-host wss:// URLs normalize with an explicit trailing slash (URL's own
// pathname default), so these constants use the already-normalized form for
// use in emission/current assertions, and RELAY_B_NO_SLASH below is the
// trailing-slash-omitted variant used to prove merge()'s normalization.
const RELAY_A = "wss://a.example.com/";
const RELAY_B = "wss://b.example.com/";
const RELAY_B_NO_SLASH = "wss://b.example.com";

describe("sameRelaySet", () => {
  it("is true for identical members in a different order", () => {
    expect(sameRelaySet([RELAY_A, RELAY_B], [RELAY_B, RELAY_A])).toBe(true);
  });

  it("is false when lengths differ", () => {
    expect(sameRelaySet([RELAY_A], [RELAY_A, RELAY_B])).toBe(false);
  });

  it("is false when members differ", () => {
    expect(sameRelaySet([RELAY_A], [RELAY_B])).toBe(false);
  });
});

describe("toRelaysObservable", () => {
  it("resolves a static array to [] then the array's members", () => {
    const emissions: string[][] = [];
    toRelaysObservable([RELAY_A]).subscribe((v) => emissions.push(v));

    expect(emissions).toEqual([[], [RELAY_A]]);
  });

  it("resolves undefined to exactly []", () => {
    const emissions: string[][] = [];
    toRelaysObservable(undefined).subscribe((v) => emissions.push(v));

    expect(emissions).toEqual([[]]);
  });

  it("resolves a BehaviorSubject seeded with a set to [] then that set, and reacts to a later emission (no take(1))", () => {
    const source = new BehaviorSubject<string[]>([RELAY_A]);
    const emissions: string[][] = [];
    toRelaysObservable(source).subscribe((v) => emissions.push(v));

    expect(emissions).toEqual([[], [RELAY_A]]);

    // A second, distinct emission must be visible to the resolved stream -
    // proves the resolver is continuous and never freezes at the first value.
    source.next([RELAY_B]);

    expect(emissions).toEqual([[], [RELAY_A], [RELAY_B]]);
  });

  it("produces no further emission when the same members are re-pushed in a new array instance", () => {
    const source = new BehaviorSubject<string[]>([RELAY_A, RELAY_B]);
    const emissions: string[][] = [];
    toRelaysObservable(source).subscribe((v) => emissions.push(v));

    expect(emissions.length).toBe(2); // [] then [RELAY_A, RELAY_B]

    // Same members, different array instance and order.
    source.next([RELAY_B, RELAY_A]);

    expect(emissions.length).toBe(2);
  });
});

describe("ExtraRelays", () => {
  it("resolves a static array synchronously with no await", () => {
    const holder = new ExtraRelays([RELAY_A]);
    expect(holder.current).toEqual([RELAY_A]);
  });

  it("reflects the latest pushed value of a BehaviorSubject synchronously after each push", () => {
    const source = new BehaviorSubject<string[]>([RELAY_A]);
    const holder = new ExtraRelays(source);

    expect(holder.current).toEqual([RELAY_A]);

    source.next([RELAY_B]);
    expect(holder.current).toEqual([RELAY_B]);
  });

  it("resolves undefined to [] and merge(base) is then an identity over base (D-14)", () => {
    const holder = new ExtraRelays(undefined);
    expect(holder.current).toEqual([]);
    expect(holder.merge([RELAY_B])).toEqual([RELAY_B]);
  });

  it("merge returns the normalized de-duplicated union of base and extras", () => {
    const holder = new ExtraRelays([RELAY_B_NO_SLASH]);
    // RELAY_B and RELAY_B_NO_SLASH normalize to the same entry, so the union
    // collapses to exactly two entries instead of three.
    expect(holder.merge([RELAY_A, RELAY_B])).toEqual([RELAY_A, RELAY_B]);
  });

  it("dispose() unsubscribes so a later push no longer changes current", () => {
    const source = new Subject<string[]>();
    const holder = new ExtraRelays(source);

    source.next([RELAY_A]);
    expect(holder.current).toEqual([RELAY_A]);

    holder.dispose();
    source.next([RELAY_B]);

    expect(holder.current).toEqual([RELAY_A]);
  });
});
