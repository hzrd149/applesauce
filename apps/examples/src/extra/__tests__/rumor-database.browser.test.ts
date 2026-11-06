import { AsyncRumorStore } from "applesauce-core/event-store";
import { getEventHash, kinds, type Rumor } from "applesauce-core/helpers";
import { firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EncryptedValue } from "../encrypted-storage";
import { RumorDatabase, type RumorCipher } from "../rumor-database";

const alice = "a".repeat(64);
const bob = "b".repeat(64);
const carol = "c".repeat(64);

// Reverses the bytes so stored payloads are not readable JSON
const cipher: RumorCipher = {
  encrypt: (value) => ({ iv: new Uint8Array(16), data: new TextEncoder().encode(value).reverse() }),
  decrypt: (value: EncryptedValue) => new TextDecoder().decode(value.data.slice().reverse()),
};

function rumor(pubkey: string, created_at: number, tags: string[][] = [], kind: number = kinds.PrivateDirectMessage) {
  const draft = { kind, pubkey, created_at, tags, content: `message ${created_at}` };
  return { ...draft, id: getEventHash(draft) } as Rumor;
}

let name: string;
let database: RumorDatabase;

beforeEach(async () => {
  name = `rumor-database-test-${crypto.randomUUID()}`;
  database = await RumorDatabase.open(name, cipher);
});

afterEach(() => {
  database.close();
  indexedDB.deleteDatabase(name);
});

describe("RumorDatabase", () => {
  it("round-trips rumors and keeps their content encrypted at rest", async () => {
    const message = rumor(alice, 100, [["p", bob]]);
    await database.add(message);

    expect(await database.hasEvent(message.id)).toBe(true);
    expect(await database.getEvent(message.id)).toEqual(message);

    database.close();
    const raw = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
    });
    const record = await new Promise<any>((resolve) => {
      const request = raw.transaction("rumors").objectStore("rumors").get(message.id);
      request.onsuccess = () => resolve(request.result);
    });
    raw.close();

    expect(record.tags).toEqual([`p:${bob}`]);
    expect(new TextDecoder().decode(record.payload.data)).not.toContain(message.content);
    database = await RumorDatabase.open(name, cipher);
  });

  it("matches conversation filters with tags, authors, time ranges and limits", async () => {
    const toBob = rumor(alice, 100, [["p", bob]]);
    const fromBob = rumor(bob, 200, [["p", alice]]);
    const toCarol = rumor(alice, 300, [["p", carol]]);
    const group = rumor(alice, 400, [
      ["p", bob],
      ["p", carol],
    ]);
    for (const message of [toBob, fromBob, toCarol, group]) await database.add(message);

    const conversation = { kinds: [kinds.PrivateDirectMessage], authors: [alice, bob], "#p": [alice, bob] };
    expect(await database.getTimeline(conversation)).toEqual([group, fromBob, toBob]);
    expect(await database.getTimeline({ ...conversation, since: 150, until: 350 })).toEqual([fromBob]);
    expect(await database.getTimeline({ ...conversation, limit: 2 })).toEqual([group, fromBob]);
    expect(await database.getTimeline({ "&p": [bob, carol] })).toEqual([group]);
    expect(await database.getByFilters([{ ids: [toBob.id] }, { authors: [bob] }])).toEqual([fromBob, toBob]);
    expect(await database.getSyncPairs({ authors: [bob] })).toEqual([{ id: fromBob.id, created_at: 200 }]);
  });

  it("removes rumors by id and by filters", async () => {
    const first = rumor(alice, 100, [["p", bob]]);
    const second = rumor(alice, 200, [["p", carol]]);
    const third = rumor(bob, 300, [["p", alice]]);
    for (const message of [first, second, third]) await database.add(message);

    expect(await database.remove(first)).toBe(true);
    expect(await database.remove(first.id)).toBe(false);
    expect(await database.removeByFilters({ authors: [alice] })).toBe(1);
    expect(await database.getTimeline({})).toEqual([third]);
  });

  it("reads replaceable history newest first", async () => {
    const older = rumor(alice, 100, [["d", "list"]], 30000);
    const newer = rumor(alice, 200, [["d", "list"]], 30000);
    await database.add(older);
    await database.add(newer);

    expect(await database.hasReplaceable(30000, alice, "list")).toBe(true);
    expect(await database.getReplaceable(30000, alice, "list")).toEqual(newer);
    expect(await database.getReplaceableHistory(30000, alice, "list")).toEqual([newer, older]);
    expect(await database.getReplaceableHistory(30000, alice, "other")).toBeUndefined();
  });

  it("backs an AsyncRumorStore timeline", async () => {
    const saved = rumor(alice, 100, [["p", bob]]);
    await database.add(saved);
    const store = new AsyncRumorStore({ database });

    const added = rumor(bob, 200, [["p", alice]]);
    await store.add(added);

    const timeline = await firstValueFrom(store.timeline({ kinds: [kinds.PrivateDirectMessage] }));
    expect(timeline.map((message) => message.id)).toEqual([added.id, saved.id]);
    expect(await database.hasEvent(added.id)).toBe(true);
  });
});
