import { EventStore } from "applesauce-core";
import type { NostrEvent } from "applesauce-core/helpers";
import { expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fixtures.js";
import { TrustedProviderList } from "../trusted-assertions.js";

it("selects providers by assertion kind and tag", () => {
  const store = new EventStore();
  const event: NostrEvent = {
    kind: 10040,
    pubkey: "a".repeat(64),
    id: "b".repeat(64),
    sig: "",
    content: "",
    created_at: 1,
    tags: [
      ["30383:reaction_cnt", "c".repeat(64), "wss://reactions.test"],
      ["30383:comment_cnt", "d".repeat(64), "wss://comments.test"],
      ["30384:reaction_cnt", "e".repeat(64), "wss://address.test"],
    ],
  };
  const list = new TrustedProviderList(event, store);
  const providers: string[][] = [];
  const sub = list
    .providersFor$(30383, "reaction_cnt")
    .subscribe((values) => providers.push(values.map((p) => p.pubkey)));
  expect(providers.at(-1)).toEqual(["c".repeat(64)]);
  sub.unsubscribe();
});

it("updates metric providers when hidden declarations unlock", async () => {
  const user = new FakeUser();
  const key = "d".repeat(64);
  const event = user.event({
    kind: 10040,
    tags: [],
    content: await user.nip44.encrypt(user.pubkey, JSON.stringify([["30383:reaction_cnt", key, "wss://hidden.test"]])),
  });
  const store = new EventStore();
  store.add(event);
  const list = new TrustedProviderList(event, store);
  const values: string[][] = [];
  const sub = list
    .providersFor$(30383, "reaction_cnt")
    .subscribe((providers) => values.push(providers.map((p) => p.pubkey)));
  expect(values.at(-1)).toEqual([]);
  await list.unlock(user);
  expect(values.at(-1)).toEqual([key]);
  sub.unsubscribe();
});
