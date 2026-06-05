import { Mint } from "@cashu/cashu-ts";
import { normalizeURL } from "applesauce-core/helpers";

/**
 * A simple cache of cashu-ts {@link Mint} instances keyed by normalized url.
 *
 * A {@link Mint} caches the mint's info and owns a single WebSocket connection, so reusing instances
 * avoids re-fetching mint info and keeps one socket per mint. Cashu `Wallet` instances are wallet-specific
 * and are created and cached by the owner (e.g. the `NutWallet` class), not here.
 */
export class MintRegistry {
  protected mints = new Map<string, Mint>();

  /** Returns the cached {@link Mint} for a url, creating it if it does not exist */
  get(url: string): Mint {
    const key = normalizeURL(url);
    let mint = this.mints.get(key);
    if (!mint) {
      mint = new Mint(key);
      this.mints.set(key, mint);
    }
    return mint;
  }

  /**
   * Reconciles the cache to a set of urls and returns the matching {@link Mint} instances.
   * Mints that are no longer in the list have their WebSocket disconnected and are dropped.
   */
  sync(urls: string[]): Mint[] {
    const keys = new Set(urls.map(normalizeURL));
    for (const [key, mint] of this.mints) {
      if (!keys.has(key)) {
        mint.disconnectWebSocket();
        this.mints.delete(key);
      }
    }
    return urls.map((url) => this.get(url));
  }

  /** Disconnects every cached mint's WebSocket and clears the cache */
  dispose(): void {
    for (const mint of this.mints.values()) mint.disconnectWebSocket();
    this.mints.clear();
  }
}
