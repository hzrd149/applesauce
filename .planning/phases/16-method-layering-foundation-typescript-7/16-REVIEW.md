---
phase: 16-method-layering-foundation-typescript-7
reviewed: 2026-08-19T18:53:23Z
depth: standard
files_reviewed: 41
files_reviewed_list:
  - apps/agent-skills/package.json
  - apps/examples/package.json
  - apps/llms/package.json
  - apps/llms/src/build-exports.mjs
  - package.json
  - packages/accounts/package.json
  - packages/accounts/tsconfig.json
  - packages/actions/package.json
  - packages/actions/tsconfig.json
  - packages/common/package.json
  - packages/common/tsconfig.json
  - packages/concord/package.json
  - packages/concord/tsconfig.json
  - packages/content/package.json
  - packages/content/tsconfig.json
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/extra/package.json
  - packages/extra/tsconfig.json
  - packages/loaders/package.json
  - packages/loaders/tsconfig.json
  - packages/react/package.json
  - packages/react/tsconfig.json
  - packages/relay/package.json
  - packages/relay/src/__tests__/relay.test.ts
  - packages/relay/src/operators/auth-retry.ts
  - packages/relay/src/relay.ts
  - packages/relay/tsconfig.json
  - packages/signers/package.json
  - packages/signers/src/signers/nostr-connect-provider.ts
  - packages/signers/src/signers/nostr-connect-signer.ts
  - packages/signers/src/signers/serial-port-signer.ts
  - packages/signers/tsconfig.json
  - packages/sqlite/package.json
  - packages/sqlite/tsconfig.json
  - packages/wallet-connect/package.json
  - packages/wallet-connect/src/wallet-service.ts
  - packages/wallet-connect/tsconfig.json
  - packages/wallet/package.json
  - packages/wallet/src/wallet/nut-wallet.ts
  - packages/wallet/tsconfig.json
findings:
  critical: 1
  warning: 0
  info: 0
  total: 1
status: issues_found
---

# Phase 16: Code Review Report

**Reviewed:** 2026-08-19T18:53:23Z
**Depth:** standard
**Files Reviewed:** 41
**Status:** issues_found

## Narrative Findings (AI reviewer)

## Summary

The TypeScript 7 migration builds inside the workspace, but the declaration-portability workaround leaks a dev-only type package into the published API of two packages. A clean downstream TypeScript project cannot type-check the emitted declarations. No additional correctness or security defect was proven in the reviewed relay comments, compiler bridge, manifests, or configuration changes.

## Critical Issues

### CR-01: Emitted declarations reference a dependency consumers do not receive

**Files:**

- `packages/signers/src/signers/nostr-connect-provider.ts:12`
- `packages/signers/src/signers/nostr-connect-signer.ts:6`
- `packages/signers/src/signers/serial-port-signer.ts:13`
- `packages/wallet-connect/src/wallet-service.ts:3`
- `packages/signers/package.json:62`
- `packages/wallet-connect/package.json:75`

**Issue:** The new protected-field annotations import `Debugger` from `debug`. TypeScript emits those imports and fields into the packages' public declaration files (`dist/signers/*.d.ts` and `dist/wallet-service.d.ts`). However, `debug` has no bundled declarations and both packages list `@types/debug` only in `devDependencies`, which are not installed for consumers. In an isolated project, the emitted declaration shape fails with `TS2307: Cannot find module 'debug' or its corresponding type declarations`. This makes the published TypeScript API unusable for consumers that check dependency declarations without `skipLibCheck`.

**Fix:** Make the emitted type resolvable by consumers. The smallest fix is to move `@types/debug` from `devDependencies` to `dependencies` in both published packages (retaining `debug` as the signers runtime dependency). Alternatively, annotate `log` with a project-owned structural logger interface that does not emit a reference to `debug`.

```json
{
  "dependencies": {
    "@types/debug": "^4.1.12"
  }
}
```

---

_Reviewed: 2026-08-19T18:53:23Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
