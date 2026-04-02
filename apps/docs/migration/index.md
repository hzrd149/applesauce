---
title: Migrations
description: Version-to-version upgrade guides for applesauce
---

# Migrations

These guides are checklists for upgrading between major versions: import moves, API changes, and behavior differences. Start with the guide that matches your **current** version and work forward one major at a time.

- [v5 → v6](/migration/v5-v6) — factory rewrite, relay `req` messages, React provider surface
- [v4 → v5](/migration/v4-v5) — `applesauce-common`, `EventFactory`, signer and import moves
- [v2 → v3](/migration/v2-v3) — async signers and accounts, NIP-07 changes
- [v1 → v2](/migration/v1-v2) — functional loaders, Queries → Models

If you are several versions behind, follow each guide in order (for example v4 app: v4→v5, then v5→v6).
