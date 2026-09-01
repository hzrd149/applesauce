---
phase: 22-req-family-re-layer
plan: 01
status: complete
subsystem: relay
tags: [req, raw, lifecycle]
---
# Phase 22 Plan 01: Raw REQ Summary

Raw `req()` now owns one readiness-aware shared wire interaction with an ID-only option surface, lifecycle values, typed terminal errors, and exact CLOSE teardown.

## Verification

- Raw and full Relay suites pass.
- Relay build passes.

## Deviations from Plan

Implementation landed with Plan 02's compositor in one source commit because the high-level consumers had to remain operational at the boundary cut.

## Self-Check: PASSED
