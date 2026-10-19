import { Subject } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import { kinds } from "../../helpers/event.js";
import { ProfilePointer } from "../../helpers/pointers.js";
import { includeMailboxes } from "../relay-selection.js";

describe("includeMailboxes", () => {
  it("should emit an empty list when the contacts are cleared", () => {
    const store = new EventStore();
    const contacts$ = new Subject<ProfilePointer[]>();
    const values: ProfilePointer[][] = [];
    contacts$.pipe(includeMailboxes(store)).subscribe((v) => values.push(v));

    contacts$.next([{ pubkey: new FakeUser().pubkey }]);
    contacts$.next([]);

    expect(values.at(-1)).toEqual([]);
  });

  it("should add relays from each user's relay list", () => {
    const store = new EventStore();
    const [alice, bob] = [new FakeUser(), new FakeUser()];
    store.add(alice.event({ kind: kinds.RelayList, tags: [["r", "wss://alice.example.com/"]] }));
    const contacts$ = new Subject<ProfilePointer[]>();
    const values: ProfilePointer[][] = [];
    contacts$.pipe(includeMailboxes(store)).subscribe((v) => values.push(v));

    contacts$.next([{ pubkey: alice.pubkey }, { pubkey: bob.pubkey }]);
    expect(values.at(-1)).toEqual([
      { pubkey: alice.pubkey, relays: ["wss://alice.example.com/"] },
      { pubkey: bob.pubkey },
    ]);

    store.add(bob.event({ kind: kinds.RelayList, tags: [["r", "wss://bob.example.com/"]] }));
    expect(values.at(-1)?.[1]).toEqual({ pubkey: bob.pubkey, relays: ["wss://bob.example.com/"] });
  });

  it("should only subscribe to new users and emit once when the contacts change", () => {
    const store = new EventStore();
    const users = Array.from({ length: 3 }, () => new FakeUser());
    const replaceable = vi.spyOn(store, "replaceable");
    const contacts$ = new Subject<ProfilePointer[]>();
    const values: ProfilePointer[][] = [];
    contacts$.pipe(includeMailboxes(store)).subscribe((v) => values.push(v));

    contacts$.next(users.slice(0, 2).map((u) => ({ pubkey: u.pubkey })));
    expect(replaceable).toHaveBeenCalledTimes(2);
    expect(values).toHaveLength(1);

    contacts$.next(users.map((u) => ({ pubkey: u.pubkey })));
    expect(replaceable).toHaveBeenCalledTimes(3);
    expect(values).toHaveLength(2);
    expect(values.at(-1)?.map((u) => u.pubkey)).toEqual(users.map((u) => u.pubkey));
  });

  it("should stop listening to removed users", () => {
    const store = new EventStore();
    const [alice, bob] = [new FakeUser(), new FakeUser()];
    const contacts$ = new Subject<ProfilePointer[]>();
    const values: ProfilePointer[][] = [];
    contacts$.pipe(includeMailboxes(store)).subscribe((v) => values.push(v));

    contacts$.next([{ pubkey: alice.pubkey }, { pubkey: bob.pubkey }]);
    contacts$.next([{ pubkey: alice.pubkey }]);
    const count = values.length;
    store.add(bob.event({ kind: kinds.RelayList, tags: [["r", "wss://bob.example.com/"]] }));

    expect(values).toHaveLength(count);
    expect(values.at(-1)).toEqual([{ pubkey: alice.pubkey }]);
  });
});
