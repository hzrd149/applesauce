---
phase: 16-method-layering-foundation-typescript-7
plan: 07
subsystem: tooling
tags: [typescript-7, declarations, compiler-api]
requires: [16-02, 16-03, 16-04, 16-05, 16-06]
provides: [reproducible TypeScript 7 workspace, TypeScript 6 compiler API bridge]
affects: [all workspace packages]
tech-stack: { added: [typescript@7.0.2, "@typescript/typescript6@6.0.2"], patterns: [portable declaration annotations] }
key-files: { created: [], modified: [apps/llms/package.json, apps/llms/src/build-exports.mjs, pnpm-lock.yaml, packages/signers/src/signers/nostr-connect-provider.ts, packages/wallet-connect/src/wallet-service.ts, packages/wallet/src/wallet/nut-wallet.ts] }
decisions: ["Keep the llms AST scanner on the official TypeScript 6 compatibility API while all CLI compilation uses TypeScript 7."]
metrics: { tasks: 2, completed: 2026-08-19 }
status: complete
---
# Phase 16 Plan 07: TypeScript 7 Workspace Acceptance Summary

TypeScript 7.0.2 now compiles the entire workspace, while the llms AST scanner uses Microsoft's separately named TypeScript 6 compatibility API.

## Verification

- `pnpm --filter applesauce-llms build`: passed.
- `pnpm exec tsc --version`: `Version 7.0.2`.
- `pnpm install --frozen-lockfile`: passed.
- `pnpm run build`: 18/18 workspace tasks passed.
- `pnpm run test`: 277 files passed, 1 skipped; 2,684 tests passed, 2 skipped.
- All 14 package builds emitted at least one declaration file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added portable logger field annotations**
- **Found during:** Task 2 full workspace build
- **Issue:** TypeScript 7 rejected inferred protected logger types that referenced another package's nested `@types/debug` path.
- **Fix:** Imported `Debugger` as a type and annotated four exported class fields without changing runtime behavior.
- **Files modified:** Three signers, wallet-connect wallet service.
- **Commit:** `ba8a3da6`

**2. [Rule 3 - Blocking] Added the missing NodeNext import extension**
- **Found during:** Task 2 full workspace build
- **Issue:** TypeScript 7 rejected the wallet's extensionless side-effect import under NodeNext resolution.
- **Fix:** Changed the module specifier to `../casts/__register__.js`.
- **Files modified:** `packages/wallet/src/wallet/nut-wallet.ts`
- **Commit:** `ba8a3da6`

## Known Stubs

None.

## Self-Check: PASSED
