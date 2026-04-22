---
description: Tools for parsing and rendering Nostr event content including text notes, markdown articles, mentions, hashtags, links, emojis, and media
---

# Content

The `applesauce-content` package turns the raw `content` field of a Nostr event into a structured tree you can render. It handles the messy parts — NIP-19 mentions, hashtags, URLs, lightning invoices, cashu tokens, custom emojis, image galleries, Blossom URIs — so your rendering layer only has to decide how each node type looks.

The package is split into three modules for different event kinds and rendering targets:

- **Text** — parses kind 1 notes and chat messages into a NAST (Nostr Abstract Syntax Tree)
- **Markdown** — remark transformers for kind 30023 long-form articles
- **React** — hooks for rendering parsed trees as JSX

## Features

- NAST parser for text notes with a composable transformer pipeline
- Default transformers for links, NIP-19 mentions, hashtags, NIP-30 emojis, image galleries, lightning invoices, cashu tokens, Blossom URIs, and more
- Parsed results are cached on the event, so re-renders are free
- Remark plugins for markdown articles with automatic NIP-21 / NIP-19 linkification
- Works with any renderer — React, plain DOM, server-side, or your own

## Installation

:::code-group

```sh [npm]
npm install applesauce-content
```

```sh [yarn]
yarn install applesauce-content
```

```sh [pnpm]
pnpm install applesauce-content
```

:::
