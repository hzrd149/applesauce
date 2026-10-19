# Security Policy

## Reporting a vulnerability

Please do **not** open a public GitHub issue for security vulnerabilities.

Report privately through GitHub's **Private vulnerability reporting** (Security tab → "Report a vulnerability") on the upstream repository, or contact the maintainer directly. Include a description of the issue, the affected packages and versions, and a reproduction or proof of concept if possible.

Please allow time for a fix to be developed and released before any public disclosure.

## Scope

The [packages/](./packages) directory contains the published libraries. Reports concerning the example or documentation apps are also welcome, but the libraries are the primary attack surface since downstream Nostr clients build on them.

## Known security considerations

- Replacing the wrapped-event verifier or marking events verified without checking them bypasses signature verification; use these APIs only with a trusted verification path.
- Secret material persisted by apps — private keys via `toJSON()`, `nbunksec` session strings, Cashu tokens, NIP-47 secrets — is **plaintext** unless the app supplies its own encryption (e.g. `PasswordAccount`'s NIP-49 `ncryptsec`). Treat everything these helpers serialize as a bearer credential.

## Cryptographic dependencies

Signature and encryption primitives are delegated to [`nostr-tools`](https://github.com/nbd-wtf/nostr-tools) (backed by `@noble/*`). Issues in those layers should be reported upstream there.
