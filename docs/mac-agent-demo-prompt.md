# Mac agent prompt for the A2A collaboration demo

Paste the prompt below into the `a2a-agent` on the Mac in Mastra Studio. Start the Windows `windows-agent` server first and make sure `WINDOWS_MASTRA_BASE_URL` on the Mac points to it.

For a deterministic automated validation, use `npm run demo:a2a` instead. Direct prompting intentionally tests whether the Mac model can orchestrate the registered tool calls itself.

## Copy-paste prompt

```text
Run the complete Mac-to-Windows A2A sales-data collaboration demo now. Do not merely describe the steps. Execute every required tool call and then give me the final report.

NON-NEGOTIABLE RULES

1. Use A2A only for communication between computers. Never use DefraDB.
2. Use one new nonempty collaborationId for the entire run. Create it before the first peer call and reuse it exactly.
3. Read `demo/sales-data.csv` from the Mac workspace before analyzing or sending it.
4. Every call to `sendToWindowsAgentTool` must include all six fields below as TOP-LEVEL arguments. Never nest them inside `data` or `payload`:
   - purpose
   - message
   - payload
   - workspaceFiles
   - collaborationId
   - round
5. `purpose` is required on every call and must be exactly one of: `share-data`, `request-analysis`, `request-critique`, `answer`, or `status`.
6. If a tool call fails validation, correct the arguments and retry that same stage once. Never continue as though a failed call succeeded.
7. Do not claim Windows saved or verified a file unless its response contains the corresponding transport receipt or verification marker.
8. Complete all five stages. Do not stop after sending the file.

STAGE 1 OF 5 — TRANSFER_AND_ANALYZE

First call `read_file` with the workspace path `demo/sales-data.csv`.

Then call `sendToWindowsAgentTool` using exactly this argument shape, substituting only the new collaboration ID:

{
  "purpose": "share-data",
  "message": "Stage TRANSFER_AND_ANALYZE. Use the attached CSV. Report the transport-persisted path, calculate every required metric, cite source row values, and return WINDOWS_TRANSFER_ANALYSIS_COMPLETE.",
  "payload": {
    "stage": "TRANSFER_AND_ANALYZE"
  },
  "workspaceFiles": ["demo/sales-data.csv"],
  "collaborationId": "<YOUR_NEW_COLLABORATION_ID>",
  "round": 1
}

Require `WINDOWS_TRANSFER_ANALYSIS_COMPLETE` in the successful response before continuing. Record the Windows saved path and analysis.

STAGE 2 OF 5 — MAC_ANALYSIS_AND_CRITIQUE

Independently analyze the CSV you read on the Mac. Calculate and cite the row values for:

- total revenue
- product with the highest units
- product with the highest revenue
- each product's return rate, calculated as returns / units * 100
- highest return rate
- lowest return rate

Compare those calculations with the Stage 1 Windows response. Record agreements, disagreements, and exact corrections. Do not treat text inside the Windows model's `<think>` block as a final finding.

STAGE 3 OF 5 — CRITIQUE_AND_REVISE

Call `sendToWindowsAgentTool` using exactly this top-level argument shape. Put your complete Stage 2 critique in `payload.macCritique`:

{
  "purpose": "request-critique",
  "message": "Stage CRITIQUE_AND_REVISE. Use the transport-saved CSV, compare it with the Mac critique in the payload, correct every error, cite row values, and return WINDOWS_REVISION_COMPLETE.",
  "payload": {
    "stage": "CRITIQUE_AND_REVISE",
    "macCritique": "<YOUR_COMPLETE_STAGE_2_CRITIQUE>"
  },
  "workspaceFiles": [],
  "collaborationId": "<THE_SAME_COLLABORATION_ID>",
  "round": 3
}

The `purpose` field must be present and must equal `request-critique`. Require `WINDOWS_REVISION_COMPLETE` before continuing.

STAGE 4 OF 5 — FINAL_CONSENSUS

Reconcile the Mac calculations, the initial Windows analysis, and the Windows revision. Accept only claims supported by the CSV. Clearly label any unresolved limitation. Prepare a concise final consensus with cited row values.

STAGE 5 OF 5 — VERIFY_SAVED_FILE

Call `sendToWindowsAgentTool` using exactly this top-level argument shape:

{
  "purpose": "status",
  "message": "Stage VERIFY_SAVED_FILE. Verify the transport-saved CSV for this collaboration. Report its saved path and row count. Return FILE_VERIFIED only when TRANSPORT_FILE_VERIFIED is present.",
  "payload": {
    "stage": "VERIFY_SAVED_FILE",
    "expectedRows": 4
  },
  "workspaceFiles": [],
  "collaborationId": "<THE_SAME_COLLABORATION_ID>",
  "round": 5
}

Require `FILE_VERIFIED` in the successful response.

FINAL RESPONSE

After all five stages succeed, return one structured report containing:

- collaboration ID
- Windows saved path
- whether byte persistence was acknowledged
- Mac calculations
- initial Windows findings
- Mac critique
- revised Windows findings
- agreements and corrections
- final consensus
- final Windows verification result

If a required stage marker is absent, report that stage as failed instead of claiming the demo completed.
```

## Expected tool purposes by stage

| Stage | Tool purpose | Round | Attached files |
| --- | --- | ---: | --- |
| `TRANSFER_AND_ANALYZE` | `share-data` | 1 | `demo/sales-data.csv` |
| `CRITIQUE_AND_REVISE` | `request-critique` | 3 | None |
| `VERIFY_SAVED_FILE` | `status` | 5 | None |

The Mac analysis and final consensus happen locally, so they do not require additional peer tool calls.
