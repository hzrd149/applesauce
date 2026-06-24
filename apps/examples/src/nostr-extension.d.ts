import type { ISigner } from "applesauce-signers";

declare global {
  interface Window {
    nostr?: ISigner;
  }
}
