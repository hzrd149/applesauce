/// <reference types="vite/client" />

/** A built-in napplet bundled into one self-contained HTML string by the vite config */
declare module "*.html?napplet" {
  const html: string;
  export default html;
}

/** Svelte components, type checked by the Svelte compiler instead of tsc */
declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<any>;
  export default component;
}
