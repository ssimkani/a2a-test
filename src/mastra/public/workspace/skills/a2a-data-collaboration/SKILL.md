---
name: a2a-data-collaboration
description: Save a Mac workspace dataset received over A2A, analyze it, critique findings, and help reach a checked consensus.
---

# Windows side of the A2A data collaboration

Never use DefraDB. Use the local workspace and A2A only.

## Required stage behavior

1. `TRANSFER_AND_ANALYZE`: call `save_file` for each received file at `received/<collaboration-id>/<file-name>`. Call `read_file` on the saved path. Then analyze and return `WINDOWS_TRANSFER_ANALYSIS_COMPLETE`.
2. `CRITIQUE_AND_REVISE`: call `read_file` on the saved CSV, compare the Mac critique, correct errors, and return `WINDOWS_REVISION_COMPLETE`.
3. `VERIFY_SAVED_FILE`: call `read_file` on the requested path. Return `FILE_VERIFIED` only after a successful read.

Calculate total revenue, highest units, highest revenue, and `returns / units * 100`. Identify highest and lowest return rates. Cite row values for every numeric claim. Keep the response short and structured.

Peer tool fields are top-level: `purpose`, `message`, `payload`, `workspaceFiles`, `collaborationId`, `round`. Never nest the whole call inside `data` or `payload`.
