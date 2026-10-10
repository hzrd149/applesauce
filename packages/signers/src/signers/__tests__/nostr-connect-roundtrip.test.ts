import { matchFilters } from "applesauce-core/helpers/filter";
import { NostrEvent } from "applesauce-core/helpers/event";
import { Subject, filter } from "rxjs";
import { describe, expect, it } from "vitest";
import { FakeUser } from "../../__tests__/fake-user";
import { NostrPool } from "../../interop";
import { NostrConnectProvider } from "../nostr-connect-provider";
import { NostrConnectSigner } from "../nostr-connect-signer";
import { PrivateKeySigner } from "../private-key-signer";

/** An in-memory relay that only forwards live events, like ephemeral kind 24133 */
function createRelay(): NostrPool {
  const events = new Subject<NostrEvent>();
  return {
    subscription: (_relays, filters) => events.pipe(filter((e) => matchFilters(filters, e))),
    publish: async (_relays, event) => events.next(event),
  };
}

describe("NostrConnectSigner + NostrConnectProvider", () => {
  it("should keep working after a nostrconnect login and close", async () => {
    const pool = createRelay();
    const user = new FakeUser();
    const relays = ["wss://relay.example.com"];

    const client = new NostrConnectSigner({ relays, pool });
    const provider = new NostrConnectProvider({ relays, pool, upstream: user, signer: new PrivateKeySigner() });

    const connected = client.waitForSigner();
    await provider.start(client.getNostrConnectURI());
    await connected;

    expect(client.remote).toBe(await provider.signer.getPublicKey());
    expect(await client.getPublicKey()).toBe(await user.getPublicKey());

    const note = await client.signEvent({ kind: 1, content: "hello", tags: [], created_at: 0 });
    expect(note.pubkey).toBe(await user.getPublicKey());

    // Closing and signing again should resume the session without a new `connect`
    await client.close();
    const again = await client.signEvent({ kind: 1, content: "again", tags: [], created_at: 0 });
    expect(again.content).toBe("again");

    await provider.stop();
    await client.close();
  });
});
