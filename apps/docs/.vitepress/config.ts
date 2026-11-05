import { defineConfig } from "vitepress";

// https://vitepress.dev/reference/site-config
export default defineConfig({
  base: process.env.VITE_BASE || "/",
  title: "Applesauce",
  description: "Functional Nostr SDK for building reactive web apps",
  head: [["link", { rel: "icon", href: "/favicon.ico" }]],
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: "/icon.png",

    editLink: {
      pattern: "https://github.com/hzrd149/applesauce/edit/master/apps/docs/:path",
    },

    search: {
      provider: "local",
    },

    outline: {
      level: [2, 3],
    },

    nav: [
      { text: "Home", link: "/" },
      { text: "Examples", link: "https://applesauce.build/examples" },
      {
        text: "Reference",
        link: "https://applesauce.build/typedoc/index.html",
      },
    ],

    sidebar: [
      {
        text: "Introduction",
        collapsed: false,
        items: [
          { text: "Getting Started", link: "/introduction/getting-started" },
          { text: "Packages", link: "/introduction/packages" },
          { text: "Agents", link: "/introduction/agents" },
          { text: "Glossary", link: "/introduction/glossary" },
        ],
      },
      {
        text: "Reading events",
        collapsed: false,
        items: [
          { text: "Event Store", link: "/core/event-store" },
          { text: "Event Memory", link: "/core/event-memory" },
          { text: "Optimistic Verification", link: "/core/optimistic-verification" },
          { text: "Models", link: "/core/models" },
          { text: "Casting", link: "/core/casting" },
          { text: "Helpers", link: "/core/helpers" },
        ],
      },
      {
        text: "Loading events",
        collapsed: false,
        items: [
          {
            text: "Relays",
            collapsed: true,
            link: "/loading/relays/package",
            items: [
              { text: "Relays", link: "/loading/relays/relays" },
              { text: "Relay Pool", link: "/loading/relays/pool" },
              {
                text: "Liveness",
                collapsed: true,
                link: "/loading/relays/liveness",
                items: [
                  { text: "Client-side Tracking", link: "/loading/relays/local-liveness" },
                  { text: "Remote Monitors", link: "/loading/relays/remote-monitor-liveness" },
                ],
              },
              { text: "Authentication", link: "/loading/relays/authentication" },
              { text: "Relay Information", link: "/loading/relays/relay-information" },
              { text: "Counting", link: "/loading/relays/counting" },
              { text: "Negentropy", link: "/loading/relays/negentropy" },
              { text: "Operators", link: "/loading/relays/operators" },
            ],
          },
          {
            text: "Loaders",
            collapsed: true,
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
              { text: "Event Count Service", link: "/loading/loaders/count-service" },
            ],
          },
        ],
      },
      {
        text: "Creating events",
        collapsed: false,
        items: [
          {
            text: "Signers",
            collapsed: true,
            link: "/creating/signers/",
            items: [
              { text: "Signers", link: "/creating/signers/signers" },
              {
                text: "Nostr Connect",
                link: "/creating/signers/nostr-connect",
              },
              {
                text: "Bunker Provider",
                link: "/creating/signers/bunker-provider",
              },
            ],
          },
          {
            text: "Factory",
            collapsed: true,
            link: "/creating/factory/",
            items: [
              {
                text: "Event Factory",
                link: "/creating/factory/event-factory",
              },
              { text: "Common Factories", link: "/creating/factory/common-factories" },
              { text: "Extending Factories", link: "/creating/factory/extending-factories" },
              {
                text: "Event Operations",
                link: "/creating/factory/event-operations",
              },
              {
                text: "Tag Operations",
                link: "/creating/factory/tag-operations",
              },
            ],
          },
        ],
      },
      {
        text: "Building apps",
        collapsed: false,
        items: [
          {
            text: "Accounts",
            collapsed: true,
            link: "/apps/accounts/",
            items: [
              { text: "Manager", link: "/apps/accounts/manager" },
              { text: "Accounts", link: "/apps/accounts/accounts" },
            ],
          },
          {
            text: "Actions",
            collapsed: true,
            link: "/apps/actions/",
            items: [
              { text: "Action Runner", link: "/apps/actions/action-runner" },
              { text: "Actions", link: "/apps/actions/actions" },
            ],
          },
          {
            text: "Authentication",
            collapsed: false,
            items: [{ text: "Nostr Web Tokens", link: "/apps/auth/nostr-web-tokens" }],
          },
          {
            text: "React",
            collapsed: false,
            link: "/apps/react/",
            items: [{ text: "use$", link: "/apps/react/use-observable" }],
          },
          {
            text: "Casting",
            collapsed: true,
            items: [
              { text: "Events", link: "/apps/casting/events" },
              { text: "Users", link: "/apps/casting/users" },
            ],
          },
          {
            text: "Content",
            collapsed: true,
            link: "/apps/content/",
            items: [
              { text: "Text", link: "/apps/content/text" },
              { text: "Markdown", link: "/apps/content/markdown" },
              { text: "React", link: "/apps/content/react" },
            ],
          },
          {
            text: "Encryption",
            collapsed: false,
            items: [{ text: "Caching", link: "/apps/encryption/caching" }],
          },
        ],
      },
      {
        text: "Connecting bitcoin",
        collapsed: false,
        items: [
          {
            text: "Wallet Connect",
            collapsed: true,
            link: "/money/wallet-connect/package",
            items: [
              { text: "Connect", link: "/money/wallet-connect/wallet-connect" },
              { text: "Service", link: "/money/wallet-connect/wallet-service" },
            ],
          },
          {
            text: "Wallet",
            collapsed: true,
            link: "/money/wallet/package",
            items: [
              { text: "NutWallet", link: "/money/wallet/nut-wallet" },
              { text: "Actions", link: "/money/wallet/actions" },
              { text: "Casts", link: "/money/wallet/casts" },
              { text: "Models", link: "/money/wallet/models" },
            ],
          },
        ],
      },
      {
        text: "Features",
        collapsed: false,
        items: [
          {
            text: "Social",
            collapsed: true,
            items: [
              { text: "Profiles", link: "/features/social/profiles" },
              { text: "Follows", link: "/features/social/follows" },
              { text: "Notes & Threads", link: "/features/social/notes-and-threads" },
              { text: "Comments", link: "/features/social/comments" },
              { text: "Reactions & Reposts", link: "/features/social/reactions-and-reposts" },
              { text: "Zaps", link: "/features/social/zaps" },
              { text: "Bookmarks", link: "/features/social/bookmarks" },
              { text: "User Statuses", link: "/features/social/user-statuses" },
              { text: "Groups", link: "/features/social/groups" },
            ],
          },
          {
            text: "Publishing",
            collapsed: true,
            items: [
              { text: "Articles", link: "/features/publishing/articles" },
              { text: "Code Snippets", link: "/features/publishing/code-snippets" },
              { text: "Git", link: "/features/publishing/git" },
              { text: "Live Streams", link: "/features/publishing/live-streams" },
              { text: "App Handlers", link: "/features/publishing/app-handlers" },
            ],
          },
          {
            text: "Files",
            collapsed: true,
            items: [
              { text: "Blossom Servers", link: "/features/files/blossom-servers" },
              { text: "Encrypted Files", link: "/features/files/encrypted-files" },
              { text: "Nostr Sites", link: "/features/files/nostr-sites" },
              { text: "Torrents", link: "/features/files/torrents" },
            ],
          },
          {
            text: "Relays",
            collapsed: true,
            items: [
              { text: "Mailboxes & Outbox", link: "/features/relays/outbox" },
              { text: "Relay Lists", link: "/features/relays/relay-lists" },
              { text: "Relay Monitoring", link: "/features/relays/relay-monitoring" },
            ],
          },
          {
            text: "Moderation",
            collapsed: true,
            items: [
              { text: "Mutes & Reports", link: "/features/moderation/mutes-and-reports" },
              { text: "Spam Filtering", link: "/features/moderation/spam-filtering" },
            ],
          },
        ],
      },
      {
        text: "Extras",
        collapsed: false,
        link: "/extra/",
        items: [
          { text: "Overview", link: "/extra/" },
          { text: "Messaging Clients", link: "/extra/messages" },
          { text: "Gift-wrap Receiver", link: "/extra/gift-wrap" },
          { text: "Double-ratchet Messaging", link: "/extra/ndr" },
          { text: "Primal Cache", link: "/extra/primal" },
          { text: "Vertex", link: "/extra/vertex" },
          { text: "Open Ranking", link: "/extra/open-ranking" },
        ],
      },
      {
        text: "Napplets",
        collapsed: false,
        link: "/napplets/",
        items: [
          { text: "Overview", link: "/napplets/" },
          { text: "Manifests & Discovery", link: "/napplets/manifests" },
          { text: "Handlers & Intents", link: "/napplets/handlers" },
          { text: "Hosting", link: "/napplets/hosting" },
          { text: "Services & Adapters", link: "/napplets/services" },
          { text: "Messaging", link: "/napplets/messaging" },
        ],
      },
      {
        text: "Storing events",
        collapsed: false,
        link: "/storage/",
        items: [
          {
            text: "Caching",
            collapsed: true,
            link: "/storage/caching/",
            items: [
              { text: "nostr-idb", link: "/storage/caching/nostr-idb" },
              { text: "Worker Relay", link: "/storage/caching/worker-relay" },
              {
                text: "window.nostrdb.js",
                link: "/storage/caching/window.nostrdb",
              },
            ],
          },
          {
            text: "Databases",
            collapsed: true,
            link: "/storage/databases/",
            items: [
              {
                text: "Better SQLite3",
                link: "/storage/databases/better-sqlite3",
              },
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
        collapsed: true,
        items: [
          { text: "v6 to v7", link: "/migration/v6-v7" },
          { text: "v5 to v6", link: "/migration/v5-v6" },
          { text: "v4 to v5", link: "/migration/v4-v5" },
          { text: "v2 to v3", link: "/migration/v2-v3" },
          { text: "v1 to v2", link: "/migration/v1-v2" },
        ],
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/hzrd149/applesauce",
      },
    ],
  },
});
