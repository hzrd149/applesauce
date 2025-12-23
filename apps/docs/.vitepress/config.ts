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
            link: "/relays/package",
            items: [
              { text: "Relays", link: "/relays/relays" },
              { text: "Relay Pool", link: "/relays/pool" },
              { text: "Liveness", link: "/relays/liveness" },
              { text: "Negentropy", link: "/relays/negentropy" },
              { text: "Operators", link: "/relays/operators" },
            ],
          },
          {
            text: "Loaders",
            link: "/loaders/package",
            items: [
              { text: "Event Loader", link: "/loaders/event-loader" },
              { text: "Address Loader", link: "/loaders/address-loader" },
              { text: "Unified Loader", link: "/loaders/unified-loader" },
              { text: "Timeline Loader", link: "/loaders/timeline-loader" },
              { text: "Zaps Loader", link: "/loaders/zaps-loader" },
              { text: "Reactions Loader", link: "/loaders/reactions-loader" },
              { text: "Tag Value Loader", link: "/loaders/tag-value-loader" },
            ],
          },
        ],
      },
      {
        text: "Creating events",
        items: [
          {
            text: "Factory",
            link: "/factory/index",
            items: [
              { text: "Event Factory", link: "/factory/event-factory" },
              { text: "Blueprints", link: "/factory/blueprints" },
              { text: "Event Operations", link: "/factory/event-operations" },
              { text: "Tag Operations", link: "/factory/tag-operations" },
            ],
          },
        ],
      },
      {
        text: "Building apps",
        items: [
          {
            text: "Signers",
            link: "/signers/index",
            items: [
              { text: "Signers", link: "/signers/signers" },
              { text: "Nostr Connect", link: "/signers/nostr-connect" },
              { text: "Bunker Provider", link: "/signers/bunker-provider" },
            ],
          },
          {
            text: "Accounts",
            link: "/accounts/index",
            items: [
              { text: "Manager", link: "/accounts/manager" },
              { text: "Accounts", link: "/accounts/accounts" },
            ],
          },
          {
            text: "Actions",
            link: "/actions/index",
            items: [
              { text: "Action Runner", link: "/actions/action-runner" },
              { text: "Actions", link: "/actions/actions" },
            ],
          },
          { text: "React", link: "/react/index", items: [{ text: "use$", link: "/react/use-observable" }] },
        ],
      },
      {
        text: "Connecting bitcoin",
        items: [
          {
            text: "Wallet Connect",
            link: "/wallet-connect/package",
            items: [
              { text: "Connect", link: "/wallet-connect/wallet-connect" },
              { text: "Service", link: "/wallet-connect/wallet-service" },
            ],
          },
          {
            text: "Wallet",
            link: "/wallet/package",
            items: [
              { text: "Actions", link: "/wallet/actions" },
              { text: "Models", link: "/wallet/models" },
            ],
          },
        ],
      },
      {
        text: "Storing events",
        items: [
          {
            text: "SQLite",
            link: "/sqlite/index",
            items: [
              { text: "Better SQLite3", link: "/sqlite/better-sqlite3" },
              { text: "Native SQLite", link: "/sqlite/native" },
              { text: "Bun SQLite", link: "/sqlite/bun" },
              { text: "LibSQL", link: "/sqlite/libsql" },
              { text: "Turso", link: "/sqlite/turso" },
              { text: "Turso Wasm", link: "/sqlite/turso-wasm" },
            ],
          },
        ],
      },
      {
        text: "Content",
        link: "/content/package",
        items: [
          { text: "Text", link: "/content/text" },
          { text: "Markdown", link: "/content/markdown" },
        ],
      },
      {
        text: "Migrations",
        items: [
          { text: "v2 to v3", link: "/migration/v2-v3" },
          { text: "v1 to v2", link: "/migration/v1-v2" },
        ],
      },
    ],

    socialLinks: [{ icon: "github", link: "https://github.com/hzrd149/applesauce" }],
  },
});
