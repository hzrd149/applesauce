# Examples Cleanup Verification

The 105 examples from the original review have been cleaned up against [AGENTS.md](./AGENTS.md). The original findings were addressed in their existing example pages and shared controls; specialized API lessons and React DOM integrations remain focused on their subjects.

## Verified source patterns

These counts cover the original 105-file inventory, excluding new examples created concurrently by other work.

| Pattern                | Before | After |
| ---------------------- | -----: | ----: |
| useState               |    100 |     0 |
| useEffect              |     55 |     4 |
| manual subscribe calls |     29 |     1 |
| card classes           |     56 |     0 |
| shadow classes         |     39 |     0 |
| form-control           |     17 |     0 |

Remaining effects integrate HLS/media observers, container sizing, graph rendering/fullscreen/resize behavior, or React Hook Form while preserving dirty values. The remaining explicit subscription is inside the Primal transport adapter; its enclosing observable owns subscription and client teardown. Observable data is consumed at React boundaries with `use$`.

Wallet recovery records include encrypted quotes, exact blinded outputs, serialized proofs and signed publication events. Retry paths preserve recovery records until relay acceptance; explicit legacy migration writes encrypted backups before removing plaintext copies. Recovery namespaces and cleanup callbacks preserve wallet ownership across account changes.

## Validation

- TypeScript project check and production examples build.
- 20 focused tests for relay membership, revisions, error isolation, teardown, publish acceptance, encrypted couch mutations/migration, mint issuance, recovery and publication retries.
- Offline browser smoke checks of all 105 reviewed example pages both logged out and with a generated test account, including route changes and initial rendering.
- Hook-ordering source scan, formatting checks and `git diff --check`.

The browser checks exercise local rendering and lifecycle behavior with external requests blocked. Minting, payment and relay acceptance failure scenarios use mocks; these checks do not claim live payment or relay interoperability verification. Existing bundler deprecation, vendor module and chunk-size warnings remain.

## Reviewed coverage

Each example in these folders was reviewed and cleaned up where needed. The example shell owns application navigation; feature controls, modal titles and section headings remain within examples.

| Folder            | Examples |
| ----------------- | -------: |
| `app-data`        |        1 |
| `articles`        |        2 |
| `badges`          |        2 |
| `blossom`         |        1 |
| `bookmarks`       |        1 |
| `cache`           |        3 |
| `calendar`        |        2 |
| `casting`         |        1 |
| `comment`         |        1 |
| `contacts`        |        3 |
| `database`        |        2 |
| `emojis`          |        1 |
| `feed`            |        4 |
| `file`            |        2 |
| `gift-wrap`       |        3 |
| `git`             |        4 |
| `group`           |        3 |
| `hashtags`        |        1 |
| `highlight`       |        2 |
| `loader`          |        6 |
| `messages`        |        3 |
| `misc`            |        1 |
| `mutes`           |        1 |
| `negentrapy`      |        3 |
| `notes`           |        3 |
| `nutzap`          |        3 |
| `nwc`             |        6 |
| `outbox`          |        2 |
| `poll`            |        1 |
| `relay`           |        3 |
| `relay-discovery` |        5 |
| `rx-views`        |        4 |
| `search`          |        5 |
| `signers`         |        5 |
| `simple`          |        2 |
| `social-graph`    |        1 |
| `stream`          |        1 |
| `threading`       |        1 |
| `torrent`         |        1 |
| `wallet`          |        4 |
| `zap`             |        5 |
