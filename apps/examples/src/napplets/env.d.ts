import type { NappletGlobal } from "@napplet/core";

declare global {
  interface Window {
    /** The napplet namespace kehto injects into every napplet document */
    napplet: NappletGlobal;
  }
}

