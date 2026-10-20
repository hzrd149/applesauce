import assert from "node:assert/strict";
import { EventStore } from "jsr:@applesauce/core@^7.0.0";
import { castEvent } from "jsr:@applesauce/core@^7.0.0/casts";
import { Note } from "jsr:@applesauce/common@^7.0.0/casts";
import "jsr:@applesauce/common@^7.0.0/models";

for (const name of [
  "core",
  "common",
  "actions",
  "accounts",
  "content",
  "extra",
  "loaders",
  "react",
  "relay",
  "signers",
  "sqlite",
  "wallet",
  "wallet-connect",
]) {
  await import(`jsr:@applesauce/${name}@^7.0.0`);
}

const store = new EventStore({ verifyEvent: () => true });
try {
  const event = {
    id: "0".repeat(64),
    pubkey: "1".repeat(64),
    sig: "0".repeat(128),
    kind: 1,
    created_at: 1,
    tags: [],
    content: "JSR smoke test",
  };
  store.add(event);
  assert.equal(store.getEvent(event.id), event);
  assert.equal(castEvent(event, Note, store).event.content, event.content);
  assert.equal(typeof castEvent(event, Note, store).author.profile$.subscribe, "function");
  const subscription = store.mutes(event.pubkey).subscribe();
  subscription.unsubscribe();
} finally {
  store.dispose();
}

console.log("Loaded all 13 JSR workspace packages and verified shared stores, casts, and augmented models");
