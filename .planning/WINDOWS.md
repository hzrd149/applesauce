---
schema_version: 1
open_count: 8
waived_count: 0
fixed_count: 0
total_count: 8
last_updated: 2026-09-06T21:17:53.659Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 3 | 17 | deviation | .planning/STATE.md |  | Corrected stale 5/5 plan counter after gap-closure plan 17-06 | open |  | 2026-08-20T13:19:03.596Z |  |
| 4 | 25 | deviation | packages/react/src/hooks/use-observable-state.ts |  | React 18 Strict Mode orphaned a render-phase observable subscription; fixed with a self-closing probe | open |  | 2026-09-03T15:30:13.352Z |  |
| 5 | 25.4 | deviation | packages/core/src/__tests__/exports.test.ts |  | Updated the core public export snapshot for the new logger controls | open |  | 2026-09-06T20:52:40.267Z |  |
| 6 | 25.4 | deviation | .planning/STATE.md |  | Repaired stale current-plan state after state.advance-plan could not parse its legacy format | open |  | 2026-09-06T20:57:55.982Z |  |
| 7 | 25.4 | deviation | packages/loaders/src/loaders/sync-loader.ts |  | Residual ambient debug.Debugger annotations migrated to the core Debugger contract | open |  | 2026-09-06T21:17:53.547Z |  |
| 8 | 25.4 | deviation | pnpm-lock.yaml |  | Lockfile verification scopes DEBUG-01 to workspace direct/importer dependencies while retaining unrelated third-party transitive debug records | open |  | 2026-09-06T21:17:53.659Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "17",
    "line": null,
    "description": "Added an acknowledged registry-unregister path required for ordered revocation success",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T12:24:57.153Z",
    "resolved_at": null
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "17",
    "line": null,
    "description": "Moved revocation outcome helper internal to avoid accidental public exports",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T12:24:57.273Z",
    "resolved_at": null
  },
  {
    "id": 3,
    "kind": "deviation",
    "phase": "17",
    "file": ".planning/STATE.md",
    "line": null,
    "description": "Corrected stale 5/5 plan counter after gap-closure plan 17-06",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-08-20T13:19:03.596Z",
    "resolved_at": null
  },
  {
    "id": 4,
    "kind": "deviation",
    "phase": "25",
    "file": "packages/react/src/hooks/use-observable-state.ts",
    "line": null,
    "description": "React 18 Strict Mode orphaned a render-phase observable subscription; fixed with a self-closing probe",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-03T15:30:13.352Z",
    "resolved_at": null
  },
  {
    "id": 5,
    "kind": "deviation",
    "phase": "25.4",
    "file": "packages/core/src/__tests__/exports.test.ts",
    "line": null,
    "description": "Updated the core public export snapshot for the new logger controls",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T20:52:40.267Z",
    "resolved_at": null
  },
  {
    "id": 6,
    "kind": "deviation",
    "phase": "25.4",
    "file": ".planning/STATE.md",
    "line": null,
    "description": "Repaired stale current-plan state after state.advance-plan could not parse its legacy format",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T20:57:55.982Z",
    "resolved_at": null
  },
  {
    "id": 7,
    "kind": "deviation",
    "phase": "25.4",
    "file": "packages/loaders/src/loaders/sync-loader.ts",
    "line": null,
    "description": "Residual ambient debug.Debugger annotations migrated to the core Debugger contract",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T21:17:53.547Z",
    "resolved_at": null
  },
  {
    "id": 8,
    "kind": "deviation",
    "phase": "25.4",
    "file": "pnpm-lock.yaml",
    "line": null,
    "description": "Lockfile verification scopes DEBUG-01 to workspace direct/importer dependencies while retaining unrelated third-party transitive debug records",
    "status": "open",
    "reason": "",
    "recorded_at": "2026-09-06T21:17:53.659Z",
    "resolved_at": null
  }
]
````
