import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEVER, Subscription } from "rxjs";
import { Transaction } from "../helpers/methods.js";
import { WalletConnect } from "../wallet-connect.js";

let wallet: WalletConnect;

beforeEach(() => {
  vi.useFakeTimers();

  wallet = new WalletConnect({
    secret: new Uint8Array(32).fill(1),
    relays: [],
    service: "00".repeat(32),
    subscriptionMethod: () => NEVER,
    publishMethod: async () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
});

const baseTransaction: Transaction = {
  type: "incoming",
  state: "pending",
  amount: 1000,
  fees_paid: 0,
  created_at: Math.floor(Date.now() / 1000),
  payment_hash: "a".repeat(64),
};

describe("waitForPaid", () => {
  it("resolves on payment instead of timing out immediately when there is no expiry (D3-a)", async () => {
    vi.spyOn(wallet, "supportsNotificationType").mockResolvedValue(false);
    const lookupInvoiceSpy = vi
      .spyOn(wallet, "lookupInvoice")
      .mockResolvedValue({ ...baseTransaction, state: "settled" });

    const transaction: Transaction = { ...baseTransaction, expires_at: undefined };

    const result = wallet.waitForPaid(transaction, { pollInterval: 1000 }).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );

    await vi.advanceTimersByTimeAsync(1500);

    const outcome = await result;
    expect(outcome.ok).toBe(true);
    if (outcome.ok) expect(outcome.value.state).toBe("settled");

    expect(lookupInvoiceSpy).toHaveBeenCalledWith(transaction.payment_hash, transaction.invoice);
  });

  it("clamps the expiry timer to the 32-bit timer limit (D3-b)", async () => {
    const MAX_TIMER_DELAY = 2_147_483_647;

    vi.spyOn(wallet, "supportsNotificationType").mockResolvedValue(true);
    vi.spyOn(wallet, "notification").mockReturnValue(new Subscription());

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const transaction: Transaction = {
      ...baseTransaction,
      expires_at: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    };

    // Intentionally not awaited; we only need the timer to have been scheduled.
    void wallet.waitForPaid(transaction).catch(() => {});

    await vi.advanceTimersByTimeAsync(0);

    expect(setTimeoutSpy).toHaveBeenCalled();
    for (const call of setTimeoutSpy.mock.calls) {
      expect(call[1]).toBeLessThanOrEqual(MAX_TIMER_DELAY);
    }
  });
});
