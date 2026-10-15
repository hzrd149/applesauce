import { Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
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
});
