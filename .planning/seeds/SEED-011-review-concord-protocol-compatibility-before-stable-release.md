---
id: SEED-011
status: dormant
planted: 2026-09-02
planted_during: v7.0.0 Phase 24
trigger_when: when relevant
scope: unknown
---

# SEED-011: Review Concord protocol compatibility before the first stable applesauce-concord release

## Why This Matters

`applesauce-concord` is scheduled for its first stable release with v7.0.0, while the Concord protocol repository remains an evolving source of truth. Before publishing the package to `latest`, compare the implementation against the current CORD specifications and close compatibility gaps so the stable API does not encode obsolete event shapes, validation rules, cryptographic flows, or client behavior.

## When to Surface

**Trigger:** when relevant

This seed will surface during `$gsd-new-milestone` when the milestone scope matches. It should be promoted no later than release preparation for the first stable `applesauce-concord` publication.

## Scope Estimate

**Unknown** — run `$gsd-capture --seed --enrich SEED-011` to estimate effort after reviewing upstream changes since the previous CORD-01..07 conformance audit.

## Breadcrumbs

- Canonical protocol repository: https://github.com/concord-protocol/concord
- Review the current CORD-01 through CORD-08 documents, including newly added or revised requirements such as disappearing messages, rather than relying only on the prior CORD-01..07 audit baseline.
- `.planning/ROADMAP.md` — Phase 26 coordinates v7.0.0 and the first official stable `applesauce-concord` release.
- `.planning/milestones/v1.1-ROADMAP.md` and `.planning/milestones/v1.1-REQUIREMENTS.md` — previous Concord conformance scope and decisions.
- `packages/concord/src/` — helpers, operations, client engines, protocol validation, encryption, invites, roles, rekeys, and refoundings.
- `packages/concord/UPSTREAM-NOTES.md` — prior spec ambiguities and the interpretations implemented locally.
- `packages/concord/src/**/__tests__/` — compatibility and regression coverage to update with upstream examples or vectors.
- `apps/docs/concord/` — public behavior and examples that must match the resulting stable API.

## Notes

Build an upstream-change inventory first, then audit event kinds and tags, validation and unknown-field preservation, key derivation and epoch transitions, channels and roles, invites, rekeys and refoundings, audio/video behavior, and disappearing-message support. Record spec ambiguities separately from implementation defects, add interoperability fixtures where the protocol supplies examples or vectors, and complete this review before the stable release decision is irreversible.
