import { describe, it, expect, beforeEach, vitest } from "vitest";
import { EventStore } from "applesauce-core";
import { EventFactory } from "applesauce-core";
import { ActionHub } from "applesauce-actions";
import { CheckStateEnum } from "@cashu/cashu-ts";
import { subscribeSpyTo } from "@hirez_io/observer-spy";

import { FakeUser } from "../../__tests__/fake-user.js";
import { ConsolidateTokens } from "../tokens.js";
import { WalletTokenBlueprint } from "../../blueprints/tokens.js";
import { unlockTokenContent, WALLET_TOKEN_KIND } from "../../helpers/tokens.js";

// Update the mock to allow controlling the states
const mockCheckProofsStates = vitest.fn();
vitest.mock("@cashu/cashu-ts", () => ({
  CashuMint: vitest.fn(),
  CashuWallet: vitest.fn().mockImplementation(() => ({
    checkProofsStates: mockCheckProofsStates,
  })),
  CheckStateEnum: { UNSPENT: "UNSPENT", SPENT: "SPENT" },
}));

const user = new FakeUser();
const testMint = "https://mint.test.com";

let events: EventStore;
let factory: EventFactory;
let hub: ActionHub;

beforeEach(() => {
  events = new EventStore();
  factory = new EventFactory({ signer: user });
  hub = new ActionHub(events, factory);
  // Reset the mock before each test
  mockCheckProofsStates.mockReset();
});

describe("ConsolidateTokens", () => {
  it("should combine multiple token events into a single event", async () => {
    // Set all proofs to be unspent
    mockCheckProofsStates.mockResolvedValue([{ state: CheckStateEnum.UNSPENT }, { state: CheckStateEnum.UNSPENT }]);

    // Create two token events with different proofs
    const token1 = await factory.sign(
      await factory.create(WalletTokenBlueprint, {
        mint: testMint,
        proofs: [{ amount: 10, secret: "secret1", C: "C", id: "id" }],
      }),
    );
    const token2 = await factory.sign(
      await factory.create(WalletTokenBlueprint, {
        mint: testMint,
        proofs: [{ amount: 20, secret: "secret2", C: "C", id: "id" }],
      }),
    );

    // Add tokens to event store
    events.add(token1);
    events.add(token2);

    // Run consolidate action
    const spy = subscribeSpyTo(hub.exec(ConsolidateTokens));
    await spy.onComplete();

    // First event should be the new consolidated token
    expect(spy.getValueAt(0).kind).toBe(WALLET_TOKEN_KIND);

    // Extract token content and verify proofs were combined
    const content = await unlockTokenContent(spy.getValueAt(0), user);
    expect(content.proofs).toHaveLength(2);
    expect(content.proofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, secret: "secret1" }),
        expect.objectContaining({ amount: 20, secret: "secret2" }),
      ]),
    );
    expect(content.mint).toBe(testMint);
  });

  it("should handle duplicate proofs", async () => {
    // Set all proofs to be unspent
    mockCheckProofsStates.mockResolvedValue([{ state: CheckStateEnum.UNSPENT }, { state: CheckStateEnum.UNSPENT }]);

    // Create two token events with different proofs
    const token1 = await factory.sign(
      await factory.create(WalletTokenBlueprint, {
        mint: testMint,
        proofs: [{ amount: 10, secret: "secret1", C: "C", id: "id" }],
      }),
    );
    const token2 = await factory.sign(
      await factory.create(WalletTokenBlueprint, {
        mint: testMint,
        proofs: [
          { amount: 20, secret: "secret2", C: "C", id: "id" },
          { amount: 10, secret: "secret1", C: "C", id: "id" },
        ],
      }),
    );

    // Add tokens to event store
    events.add(token1);
    events.add(token2);

    // Run consolidate action
    const spy = subscribeSpyTo(hub.exec(ConsolidateTokens));
    await spy.onComplete();

    // First event should be the new consolidated token
    expect(spy.getValueAt(0).kind).toBe(WALLET_TOKEN_KIND);

    // Extract token content and verify proofs were combined
    const content = await unlockTokenContent(spy.getValueAt(0), user);
    expect(content.proofs).toHaveLength(2);
    expect(content.proofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, secret: "secret1" }),
        expect.objectContaining({ amount: 20, secret: "secret2" }),
      ]),
    );
    expect(content.mint).toBe(testMint);
  });

  it("should filter out spent proofs", async () => {
    // Create token events with multiple proofs
    const token1 = await factory.sign(
      await factory.create(
        WalletTokenBlueprint,
        {
          mint: testMint,
          proofs: [
            { amount: 10, secret: "secret1", C: "C", id: "id" },
            { amount: 20, secret: "secret2", C: "C", id: "id" },
          ],
        },
        [],
      ),
    );
    const token2 = await factory.sign(
      await factory.create(
        WalletTokenBlueprint,
        {
          mint: testMint,
          proofs: [
            { amount: 30, secret: "secret3", C: "C", id: "id" },
            { amount: 40, secret: "secret4", C: "C", id: "id" },
          ],
        },
        [],
      ),
    );

    // Add tokens to event store
    events.add(token1);
    events.add(token2);

    // Mock some proofs as spent
    mockCheckProofsStates.mockResolvedValue([
      { state: CheckStateEnum.UNSPENT }, // secret1
      { state: CheckStateEnum.SPENT }, // secret2
      { state: CheckStateEnum.SPENT }, // secret3
      { state: CheckStateEnum.UNSPENT }, // secret4
    ]);

    // Run consolidate action
    const spy = subscribeSpyTo(hub.exec(ConsolidateTokens));
    await spy.onComplete();

    // Verify the consolidated token only contains unspent proofs
    const content = await unlockTokenContent(spy.getValueAt(0), user);
    expect(content.proofs).toHaveLength(2);
    expect(content.proofs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, secret: "secret1" }),
        expect.objectContaining({ amount: 40, secret: "secret4" }),
      ]),
    );
    expect(content.mint).toBe(testMint);

    // Verify checkProofsStates was called with all proofs
    expect(mockCheckProofsStates).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, secret: "secret1" }),
        expect.objectContaining({ amount: 20, secret: "secret2" }),
        expect.objectContaining({ amount: 30, secret: "secret3" }),
        expect.objectContaining({ amount: 40, secret: "secret4" }),
      ]),
    );
  });
});
