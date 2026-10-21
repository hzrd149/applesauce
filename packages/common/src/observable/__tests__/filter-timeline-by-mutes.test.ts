import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { EventStore } from "applesauce-core/event-store";
import { kinds } from "applesauce-core/helpers/event";
import { of } from "rxjs";
import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { filterTimelineByMutes } from "../filter-timeline-by-mutes.js";

const user = new FakeUser();
const mutedUser = new FakeUser();
const otherUser = new FakeUser();

let store: EventStore;
beforeEach(() => {
  store = new EventStore();
});

describe("filterTimelineByMutes", () => {
  it("removes muted events from the timeline", () => {
    store.add(user.event({ kind: kinds.Mutelist, tags: [["p", mutedUser.pubkey]] }));
    const muted = mutedUser.note("Hello world");
    const visible = otherUser.note("Hello world");

    const spy = subscribeSpyTo(of([muted, visible]).pipe(filterTimelineByMutes(store, user.pubkey)));
    expect(spy.getLastValue()).toEqual([visible]);
  });

  it("returns the timeline unchanged when the user has no mute list", () => {
    const timeline = [mutedUser.note("Hello world"), otherUser.note("Hello world")];

    const spy = subscribeSpyTo(of(timeline).pipe(filterTimelineByMutes(store, user.pubkey)));
    expect(spy.getLastValue()).toEqual(timeline);
  });
});
