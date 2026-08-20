---
schema_version: 1
open_count: 2
waived_count: 0
fixed_count: 0
total_count: 2
last_updated: 2026-08-20T12:24:57.273Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 17 | deviation | packages/concord/src/client/admin.ts |  | Added an acknowledged registry-unregister path required for ordered revocation success | open |  | 2026-08-20T12:24:57.153Z |  |
| 2 | 17 | deviation | packages/concord/src/client/revocation.ts |  | Moved revocation outcome helper internal to avoid accidental public exports | open |  | 2026-08-20T12:24:57.273Z |  |

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
  }
]
````
