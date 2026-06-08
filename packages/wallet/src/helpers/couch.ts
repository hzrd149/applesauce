import { Token } from "@cashu/cashu-ts";

// Type for a method that clears the couch
type ClearMethod = () => void | Promise<void>;

export interface Couch {
  /** Store a token in the couch */
  store(token: Token): ClearMethod | Promise<ClearMethod>;
  /** Clear all tokens from the couch */
  clear(): void | Promise<void>;
  /** Get all tokens currently stored in the couch */
  getAll(): Token[] | Promise<Token[]>;
  /** Remove a specific token from the couch */
  remove(token: Token): void | Promise<void>;
}
