---
name: a2a-data-collaboration
description: Transfer a workspace dataset to the peer agent, analyze it on both machines, critique findings, and reach a checked consensus using only A2A.
---

# A2A data collaboration protocol

Use one collaboration ID for the whole run. Do not use DefraDB.

## Stages

1. `TRANSFER_AND_ANALYZE`: Mac reads `demo/sales-data.csv` and calls `sendToWindowsAgentTool` with `purpose: share-data`, the file in `workspaceFiles`, round 1, and the stage in `payload`. Windows must call `save_file` to `received/<collaboration-id>/sales-data.csv`, call `read_file` to verify it, analyze it, and return `WINDOWS_TRANSFER_ANALYSIS_COMPLETE`.
2. `MAC_ANALYSIS_AND_CRITIQUE`: Mac independently calculates totals and rates, compares Windows findings, and returns `MAC_CRITIQUE_COMPLETE`.
3. `CRITIQUE_AND_REVISE`: Windows reads its saved file, checks Mac's critique, revises its findings, and returns `WINDOWS_REVISION_COMPLETE`.
4. `FINAL_CONSENSUS`: Mac reconciles both analyses, lists supported findings and limitations, and returns `FINAL_CONSENSUS_COMPLETE`.
5. `VERIFY_SAVED_FILE`: Windows reads the saved dataset and returns `FILE_VERIFIED` only after a successful read.

## Required calculations

- Total revenue: sum `revenue`.
- Highest units: largest `units` row.
- Highest revenue: largest `revenue` row.
- Return rate: `returns / units * 100` for each row.
- Highest and lowest return rates.

Every numeric claim must cite the source row values. If calculations disagree, recompute from the CSV before reaching consensus.

## Tool argument reminder

Peer tool fields are top-level: `purpose`, `message`, `payload`, `workspaceFiles`, `collaborationId`, `round`. Never place the entire call inside `data` or `payload`.
