# Phase 16 Validation Strategy

## Automated Gates

| Requirement | Evidence | Command |
|---|---|---|
| LAYER-01 | Archived Phase 13 D-01 states the immediate aggregator/retry carve-out and low/high method ownership | `rg -n "D-01|immediate consumer|aggregat|retry|low-level|high-level" .planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md` |
| LAYER-02 | Shipped citations remain exactly 10/3/1 and relay behavior remains green | `test "$(rg -c 'D-01' packages/relay/src/relay.ts)" = 10 && test "$(rg -c 'D-01' packages/relay/src/operators/auth-retry.ts)" = 3 && test "$(rg -c 'D-01' packages/relay/src/__tests__/relay.test.ts)" = 1 && pnpm --filter applesauce-relay test` |
| ECO-01 | Every direct pin is TypeScript 7, removed options are absent, the API consumer builds through the official compatibility package, declarations emit, and the workspace is green | `pnpm exec tsc --version && ! rg -n 'downlevelIteration' --glob 'tsconfig*.json' . && pnpm --filter applesauce-llms build && pnpm run build && pnpm run test && pnpm install --frozen-lockfile` |

## Declaration Evidence

After `pnpm run build`, iterate over every `packages/*/tsconfig.json` and require at least one matching `packages/*/dist/**/*.d.ts`. Generated `dist` files are evidence only and must not be committed unless already tracked and intentionally changed.

## Sampling

- Per documentation task: exact citation distribution and a comment-only diff audit.
- Per manifest/config task: source assertions limited to its owned files.
- Final plan: llms build, compiler version, frozen install, full build, full test, and all-package declaration artifact check.

## Failure Policy

Any TypeScript source diagnostic, unrelated lockfile churn, TypeDoc-driven workaround, or executable relay diff is a stop-and-investigate result rather than authority to broaden implementation scope.
