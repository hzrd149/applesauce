import { Token, getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";
import type { Couch } from "./couch.js";

const STORAGE_KEY = "applesauce:couch:tokens";

interface StoredToken {
  id: string;
  encodedToken: string;
}

/**
 * A simple localStorage-based implementation of the Couch interface.
 * Stores tokens in the browser's localStorage.
 */
export class LocalStorageCouch implements Couch {
  private storageKey: string;

  constructor(storageKey: string = STORAGE_KEY) {
    this.storageKey = storageKey;
  }

  /**
   * Generate a unique ID for each stored token.
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Store a token in the couch.
   * Returns a function that can be called to remove this specific token.
   */
  store(token: Token): () => void {
    const id = this.generateId();
    const encodedToken = getEncodedToken(token);
    const stored = this.getStoredTokens();
    stored.push({ id, encodedToken });
    this.saveStoredTokens(stored);

    // Return a function to remove this specific token by ID
    return () => {
      const currentStored = this.getStoredTokens();
      const filtered = currentStored.filter((item) => item.id !== id);
      this.saveStoredTokens(filtered);
    };
  }

  /**
   * Clear all tokens from the couch.
   */
  clear(): void {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.removeItem(this.storageKey);
    }
  }

  /**
   * Get all tokens currently stored in the couch.
   */
  getAll(): Token[] {
    const stored = this.getStoredTokens();
    return stored
      .map((item) => {
        try {
          return getDecodedToken(item.encodedToken);
        } catch {
          return null;
        }
      })
      .filter((token): token is Token => token !== null);
  }

  private getStoredTokens(): StoredToken[] {
    if (typeof window === "undefined" || !window.localStorage) {
      return [];
    }

    try {
      const stored = window.localStorage.getItem(this.storageKey);
      if (!stored) return [];
      return JSON.parse(stored) as StoredToken[];
    } catch {
      return [];
    }
  }

  private saveStoredTokens(tokens: StoredToken[]): void {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(this.storageKey, JSON.stringify(tokens));
    }
  }
}
