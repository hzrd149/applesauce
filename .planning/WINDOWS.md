---
schema_version: 1
open_count: 4
waived_count: 0
fixed_count: 0
total_count: 4
last_updated: 2026-09-03T15:30:13.352Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 17 | deviation | packages/concord/src/client/admin.ts |  | Added an acknowledged registry-unregister path required for ordered revocation success | open |  | 2026-08-20T12:24:57.153Z |  |
| 2 | 17 | deviation | packages/concord/src/client/revocation.ts |  | Moved revocation outcome helper internal to avoid accidental public exports | open |  | 2026-08-20T12:24:57.273Z |  |
| 3 | 17 | deviation | .planning/STATE.md |  | Corrected stale 5/5 plan counter after gap-closure plan 17-06 | open |  | 2026-08-20T13:19:03.596Z |  |
| 4 | 25 | deviation | packages/react/src/hooks/use-observable-state.ts |  | React 18 Strict Mode orphaned a render-phase observable subscription; fixed with a self-closing probe | open |  | 2026-09-03T15:30:13.352Z |  |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "17",
    "file": "packages/concord/src/client/admin.ts",
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
    "file": "packages/concord/src/client/revocation.ts",
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
  }
]
````
