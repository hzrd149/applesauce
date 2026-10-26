/// <reference types="vite/client" />

/** A built-in napplet bundled into one self-contained HTML string by the vite config */
declare module "*.html?napplet" {
  const html: string;
  export default html;
}
