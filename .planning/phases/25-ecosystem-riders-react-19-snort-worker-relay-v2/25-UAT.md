---
status: testing
phase: 25-ecosystem-riders-react-19-snort-worker-relay-v2
source: [25-VERIFICATION.md]
started: 2026-09-03T16:25:28Z
updated: 2026-09-03T16:25:28Z
---

## Current Test

number: 1
name: Worker/OPFS end-to-end smoke
expected: |
  Both databases remain queryable without reset, every operation settles, exact recovery controls work, and existing content remains visible after an unrelated operation fails.
awaiting: user response

## Tests

### 1. Worker/OPFS end-to-end smoke

expected: Run both worker-relay routes in a real browser with existing seeded OPFS data and confirm both databases remain queryable without reset, every operation settles, exact recovery controls work, and existing content remains visible after an unrelated operation fails.
result: [pending]

### 2. ECO-02 transparency prohibition

expected: Confirm React 19 evidence does not replace or weaken the React 18 consumer contract; the dual-major peer and both CI legs remain required.
result: [pending]

### 3. ECO-03 OPFS preservation prohibition

expected: Open both routes against pre-migration OPFS data and confirm neither database is cleared, renamed, or silently replaced.
result: [pending]

### 4. ECO-03 transparency prohibition

expected: Inspect both rendered routes during initialization and after success or failure and confirm no decorative dependency-version UI or page-blocking migration screen appears.
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
