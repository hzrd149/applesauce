import { subscribeSpyTo } from "@hirez_io/observer-spy";
import { NostrEvent } from "applesauce-core/helpers/event";

import { beforeEach, describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { EventStore } from "../../event-store/event-store.js";
import { getReplaceableIdentifier } from "../../helpers/event.js";
import { CommentsModel } from "../comments.js";

const user = new FakeUser();

let eventStore: EventStore;

beforeEach(() => {
  eventStore = new EventStore();
});

describe("CommentsModel", () => {
  it("should return all comments for newer versions of a replaceable event", () => {
    let article: NostrEvent = user.event({
      kind: 30023,
      content: "# Article",
      tags: [["d", "article-id"]],
    });

    let comment = user.event({
      kind: 1111,
      content: "Comment",
      tags: [
        ["e", article.id],
        ["k", String(article.kind)],
        ["a", getReplaceableIdentifier(article)],
        ["E", article.id],
        ["K", String(article.kind)],
        ["A", getReplaceableIdentifier(article)],
      ],
    });

    eventStore.add(article);
    eventStore.add(comment);

    const spy = subscribeSpyTo(eventStore.model(CommentsModel, article));

    expect(spy.getValueAt(0)).toEqual([comment]);
  });
});
