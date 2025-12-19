import { Token, getEncodedToken, getDecodedToken } from "@cashu/cashu-ts";
import type { Couch } from "./couch.js";

const DB_NAME = "applesauce-wallet-couch";
const STORE_NAME = "tokens";
const DB_VERSION = 1;

interface StoredToken {
  id: string;
  encodedToken: string;
}

/**
 * A simple IndexedDB-based implementation of the Couch interface.
 * Stores tokens in the browser's IndexedDB for better performance with larger datasets.
 */
export class IndexedDBCouch implements Couch {
  private dbName: string;
  private storeName: string;
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string = DB_NAME, storeName: string = STORE_NAME) {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  /**
   * Generate a unique ID for each stored token.
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Initialize the IndexedDB database and object store.
   */
  private async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !window.indexedDB) {
        reject(new Error("IndexedDB is not available"));
        return;
      }

      const request = window.indexedDB.open(this.dbName, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
    });

    return this.initPromise;
  }

  /**
   * Store a token in the couch.
   * Returns a function that can be called to remove this specific token.
   */
  async store(token: Token): Promise<() => Promise<void>> {
    const db = await this.init();
    const id = this.generateId();
    const encodedToken = getEncodedToken(token);

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.add({ id, encodedToken });

      request.onsuccess = () => {
        // Return a function to remove this specific token by ID
        resolve(async () => {
          const removeDb = await this.init();
          const removeTransaction = removeDb.transaction([this.storeName], "readwrite");
          const removeStore = removeTransaction.objectStore(this.storeName);
          const removeRequest = removeStore.delete(id);
          await new Promise<void>((resolve, reject) => {
            removeRequest.onsuccess = () => resolve();
            removeRequest.onerror = () => reject(removeRequest.error);
          });
        });
      };

      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all tokens from the couch.
   */
  async clear(): Promise<void> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], "readwrite");
      const store = transaction.objectStore(this.storeName);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all tokens currently stored in the couch.
   */
  async getAll(): Promise<Token[]> {
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.storeName], "readonly");
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result as StoredToken[];
        const tokens = results
          .map((item) => {
            try {
              return getDecodedToken(item.encodedToken);
            } catch {
              return null;
            }
          })
          .filter((token): token is Token => token !== null);
        resolve(tokens);
      };

      request.onerror = () => reject(request.error);
    });
  }
}
