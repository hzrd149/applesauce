import { ISigner } from "../interop.ts";

declare global {
  interface Window {
    nostr?: ISigner;
  }
}
