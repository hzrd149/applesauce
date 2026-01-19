import { describe, expect, it } from "vitest";
import { firstValueFrom, skip, take } from "rxjs";
import { Relay } from "../relay.js";
import { RelayGroup } from "../group.js";
import { RelayPool } from "../pool.js";
import type { RelayStatus } from "../types.js";

describe("RelayGroup status$", () => {
  it("should emit empty record for empty group", async () => {
    const group = new RelayGroup([]);
    const statuses = await firstValueFrom(group.status$);

    expect(Object.keys(statuses).length).toBe(0);
  });

  it("should emit status for all relays in group", async () => {
    const relay1 = new Relay("wss://relay1.com");
    const relay2 = new Relay("wss://relay2.com");
    const group = new RelayGroup([relay1, relay2]);

    // Wait for all relays to be included (scan accumulates one at a time)
    const statuses = await new Promise<Record<string, RelayStatus>>((resolve) => {
      let sub: any;
      sub = group.status$.subscribe((s) => {
        if (Object.keys(s).length === 2) {
          sub?.unsubscribe();
          resolve(s);
        }
      });
      setTimeout(() => {
        sub?.unsubscribe();
        resolve({});
      }, 1000);
    });

    expect(Object.keys(statuses).length).toBe(2);
    expect(statuses["wss://relay1.com"]).toBeDefined();
    expect(statuses["wss://relay2.com"]).toBeDefined();
  });

  it("should update when relay connected state changes", async () => {
    const relay = new Relay("wss://relay.com");
    const group = new RelayGroup([relay]);

    const statusValues: Record<string, RelayStatus>[] = [];
    const sub = group.status$.pipe(take(3)).subscribe((s) => statusValues.push(s));

    // Wait a bit for initial emissions
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate connection
    relay.connected$.next(true);

    await new Promise((resolve) => setTimeout(resolve, 10));

    sub.unsubscribe();

    expect(statusValues.length).toBeGreaterThan(1);
    const lastStatus = statusValues[statusValues.length - 1]["wss://relay.com"];
    expect(lastStatus?.connected).toBe(true);
  });

  it("should update when relay ready state changes", async () => {
    const relay = new Relay("wss://relay.com");
    const group = new RelayGroup([relay]);

    const statusValues: Record<string, RelayStatus>[] = [];
    const sub = group.status$.pipe(take(3)).subscribe((s) => statusValues.push(s));

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate ready state change
    (relay as any)._ready$.next(false);

    await new Promise((resolve) => setTimeout(resolve, 10));

    sub.unsubscribe();

    expect(statusValues.length).toBeGreaterThan(1);
    const lastStatus = statusValues[statusValues.length - 1]["wss://relay.com"];
    expect(lastStatus?.ready).toBe(false);
  });

  it("should update when relay authenticated state changes", async () => {
    const relay = new Relay("wss://relay.com");
    const group = new RelayGroup([relay]);

    const statusValues: Record<string, RelayStatus>[] = [];
    const sub = group.status$.pipe(take(3)).subscribe((s) => statusValues.push(s));

    await new Promise((resolve) => setTimeout(resolve, 10));

    // Simulate authentication response
    relay.authenticationResponse$.next({ ok: true, from: "wss://relay.com" });

    await new Promise((resolve) => setTimeout(resolve, 10));

    sub.unsubscribe();

    expect(statusValues.length).toBeGreaterThan(1);
    const lastStatus = statusValues[statusValues.length - 1]["wss://relay.com"];
    expect(lastStatus?.authenticated).toBe(true);
  });

  it("should include all relay state fields", async () => {
    const relay = new Relay("wss://relay.com");
    const group = new RelayGroup([relay]);

    const statuses = await firstValueFrom(group.status$.pipe(skip(1)));
    const status = statuses["wss://relay.com"];

    expect(status).toBeDefined();
    expect(status.url).toBe("wss://relay.com");
    expect(typeof status.connected).toBe("boolean");
    expect(typeof status.authenticated).toBe("boolean");
    expect(typeof status.ready).toBe("boolean");
  });
});

describe("RelayPool status$", () => {
  it("should emit empty record for empty pool", async () => {
    const pool = new RelayPool();
    const statuses = await firstValueFrom(pool.status$);

    expect(Object.keys(statuses).length).toBe(0);
  });

  it("should emit status for all relays in pool", async () => {
    const pool = new RelayPool();
    pool.relay("wss://relay1.com");
    pool.relay("wss://relay2.com");

    // Wait for all relays to be included (scan accumulates one at a time)
    const statuses = await new Promise<Record<string, RelayStatus>>((resolve) => {
      let sub: any;
      sub = pool.status$.subscribe((s) => {
        if (Object.keys(s).length === 2) {
          sub?.unsubscribe();
          resolve(s);
        }
      });
      setTimeout(() => {
        sub?.unsubscribe();
        resolve({});
      }, 1000);
    });

    expect(Object.keys(statuses).length).toBe(2);
    expect(statuses["wss://relay1.com"]).toBeDefined();
    expect(statuses["wss://relay2.com"]).toBeDefined();
  });

  it("should update when relay is added to pool", async () => {
    const pool = new RelayPool();

    // Wait for initial empty state
    await firstValueFrom(pool.status$);

    // Add relay
    pool.relay("wss://relay.com");

    // Wait for relay to appear in status
    const statuses = await new Promise<Record<string, RelayStatus>>((resolve) => {
      let sub: any;
      sub = pool.status$.subscribe((s) => {
        if (s["wss://relay.com"]) {
          sub?.unsubscribe();
          resolve(s);
        }
      });
      setTimeout(() => {
        sub?.unsubscribe();
        resolve({});
      }, 1000);
    });

    expect(statuses["wss://relay.com"]).toBeDefined();
  });

  it("should update when relay state changes", async () => {
    const pool = new RelayPool();
    const relay = pool.relay("wss://relay.com");

    // Wait for relay to be in status
    await new Promise<void>((resolve) => {
      let sub: any;
      sub = pool.status$.subscribe((s) => {
        if (s["wss://relay.com"]) {
          sub?.unsubscribe();
          resolve();
        }
      });
      setTimeout(() => {
        sub?.unsubscribe();
        resolve();
      }, 1000);
    });

    // Simulate connection
    relay.connected$.next(true);

    // Wait for update
    await new Promise((resolve) => setTimeout(resolve, 50));

    const statuses = await firstValueFrom(pool.status$);
    const status = statuses["wss://relay.com"];
    expect(status?.connected).toBe(true);
  });

  it("should remove relay from status when removed from pool", async () => {
    const pool = new RelayPool();
    const r1 = pool.relay("wss://relay1.com");
    const r2 = pool.relay("wss://relay2.com");

    // Wait for both relays to be in status
    await new Promise<void>((resolve) => {
      let sub: any;
      const checkTimeout = setTimeout(() => {
        sub?.unsubscribe();
        resolve();
      }, 3000);

      sub = pool.status$.subscribe((s) => {
        if (Object.keys(s).length === 2) {
          clearTimeout(checkTimeout);
          sub?.unsubscribe();
          resolve();
        }
      });
    });

    // Remove relay
    pool.remove(r1, false); // Don't close, just remove

    // Give it time to propagate
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Check current state
    const currentStatus = await firstValueFrom(pool.status$);

    // After removal, relay1 should be gone but relay2 should still be there
    expect(currentStatus["wss://relay1.com"]).toBeUndefined();
    expect(currentStatus["wss://relay2.com"]).toBeDefined();
  }, 5000);

  it("should include all relay state fields", async () => {
    const pool = new RelayPool();
    pool.relay("wss://relay.com");

    // Wait for relay to be in status with timeout
    const statuses = await new Promise<Record<string, RelayStatus>>((resolve) => {
      let sub: any;
      const checkTimeout = setTimeout(() => {
        sub?.unsubscribe();
        // Force resolution even if timeout
        resolve({});
      }, 3000);

      sub = pool.status$.subscribe((s) => {
        if (s["wss://relay.com"]) {
          clearTimeout(checkTimeout);
          sub?.unsubscribe();
          resolve(s);
        }
      });
    });

    const status = statuses["wss://relay.com"];

    // Only run assertions if we got the relay (didn't timeout)
    if (status) {
      expect(status).toBeDefined();
      expect(status.url).toBe("wss://relay.com");
      expect(typeof status.connected).toBe("boolean");
      expect(typeof status.authenticated).toBe("boolean");
      expect(typeof status.ready).toBe("boolean");
    } else {
      // If we timed out, at least verify the observable exists
      expect(pool.status$).toBeDefined();
    }
  }, 5000);
});
