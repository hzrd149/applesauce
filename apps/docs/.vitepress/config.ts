import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "AppleSauce",
  description: "Functional Nostr SDK for building reactive web apps",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: "/logo.png",

    editLink: {
      pattern: "https://github.com/hzrd149/applesauce/edit/master/apps/docs/:path",
    },

    search: {
      provider: "local",
    },

    nav: [
      { text: "Home", link: "/" },
      { text: "Examples", link: "https://hzrd149.github.io/applesauce/examples" },
      { text: "Snippets", link: "https://hzrd149.github.io/applesauce/snippets" },
      { text: "Reference", link: "https://hzrd149.github.io/applesauce/typedoc/index.html" },
    ],

    sidebar: [
      {
        text: "Introduction",
        items: [
          { text: "Getting Started", link: "/introduction/getting-started" },
          { text: "Packages", link: "/introduction/packages" },
          { text: "Glossary", link: "/introduction/glossary" },
        ],
      },
      {
        text: "Reading events",
        items: [
          { text: "Event Store", link: "/core/event-store" },
          { text: "Event Memory", link: "/core/event-memory" },
          { text: "Models", link: "/core/models" },
          { text: "Casting", link: "/core/casting" },
          { text: "Helpers", link: "/core/helpers" },
        ],
      },
      {
        text: "Loading events",
        items: [
          {
            text: "Relays",
            link: "/loading/relays/package",
            items: [
              { text: "Relays", link: "/loading/relays/relays" },
              { text: "Relay Pool", link: "/loading/relays/pool" },
              { text: "Liveness", link: "/loading/relays/liveness" },
              { text: "Negentropy", link: "/loading/relays/negentropy" },
              { text: "Operators", link: "/loading/relays/operators" },
            ],
          },
          {
            text: "Loaders",
            link: "/loading/loaders/package",
            items: [
              { text: "Upstream Pool", link: "/loading/loaders/upstream-pool" },
              { text: "Event Loader", link: "/loading/loaders/event-loader" },
              { text: "Address Loader", link: "/loading/loaders/address-loader" },
              { text: "Unified Loader", link: "/loading/loaders/unified-loader" },
              { text: "Timeline Loader", link: "/loading/loaders/timeline-loader" },
              { text: "Zaps Loader", link: "/loading/loaders/zaps-loader" },
              { text: "Reactions Loader", link: "/loading/loaders/reactions-loader" },
              { text: "Tag Value Loader", link: "/loading/loaders/tag-value-loader" },
            ],
          },
        ],
      },
      {
        text: "Creating events",
        items: [
          {
            text: "Signers",
            link: "/creating/signers",
            items: [
              { text: "Signers", link: "/creating/signers/signers" },
              { text: "Nostr Connect", link: "/creating/signers/nostr-connect" },
              { text: "Bunker Provider", link: "/creating/signers/bunker-provider" },
            ],
          },
          {
            text: "Factory",
            link: "/creating/factory",
            items: [
              { text: "Event Factory", link: "/creating/factory/event-factory" },
              { text: "Blueprints", link: "/creating/factory/blueprints" },
              { text: "Event Operations", link: "/creating/factory/event-operations" },
              { text: "Tag Operations", link: "/creating/factory/tag-operations" },
            ],
          },
        ],
      },
      {
        text: "Building apps",
        items: [
          {
            text: "Accounts",
            link: "/apps/accounts",
            items: [
              { text: "Manager", link: "/apps/accounts/manager" },
              { text: "Accounts", link: "/apps/accounts/accounts" },
            ],
          },
          {
            text: "Actions",
            link: "/apps/actions",
            items: [
              { text: "Action Runner", link: "/apps/actions/action-runner" },
              { text: "Actions", link: "/apps/actions/actions" },
            ],
          },
          { text: "React", link: "/apps/react", items: [{ text: "use$", link: "/apps/react/use-observable" }] },
          {
            text: "Content",
            link: "/apps/content",
            items: [
              { text: "Text", link: "/apps/content/text" },
              { text: "Markdown", link: "/apps/content/markdown" },
            ],
          },
          {
            text: "Encryption",
            items: [{ text: "Caching", link: "/apps/encryption/caching" }],
          },
        ],
      },
      {
        text: "Connecting bitcoin",
        items: [
          {
            text: "Wallet Connect",
            link: "/money/wallet-connect/package",
            items: [
              { text: "Connect", link: "/money/wallet-connect/wallet-connect" },
              { text: "Service", link: "/money/wallet-connect/wallet-service" },
            ],
          },
          {
            text: "Wallet",
            link: "/money/wallet/package",
            items: [
              { text: "Actions", link: "/money/wallet/actions" },
              { text: "Models", link: "/money/wallet/models" },
            ],
          },
        ],
      },
      {
        text: "Storing events",
        link: "/storage",
        items: [
          {
            text: "Caching",
            link: "/storage/caching",
            items: [
              { text: "nostr-idb", link: "/storage/caching/nostr-idb" },
              { text: "window.nostrdb.js", link: "/storage/caching/window.nostrdb.js" },
            ],
          },
          {
            text: "Databases",
            link: "/storage/databases",
            items: [
              { text: "Better SQLite3", link: "/storage/databases/better-sqlite3" },
              { text: "Native SQLite", link: "/storage/databases/native" },
              { text: "Bun SQLite", link: "/storage/databases/bun" },
              { text: "LibSQL", link: "/storage/databases/libsql" },
              { text: "Turso", link: "/storage/databases/turso" },
              { text: "Turso Wasm", link: "/storage/databases/turso-wasm" },
            ],
          },
        ],
      },
      {
        text: "Migrations",
        items: [
          { text: "v4 to v5", link: "/migration/v4-v5" },
          { text: "v2 to v3", link: "/migration/v2-v3" },
          { text: "v1 to v2", link: "/migration/v1-v2" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/hzrd149/applesauce" }],
  },
});
