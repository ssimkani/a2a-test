# Mac–Windows A2A data collaboration demo

This demo uses two independent local Mastra workspaces and A2A communication. It does not use DefraDB.

## What it proves

1. The Mac workspace contains `demo/sales-data.csv`.
2. The registered Mac tool reads that file and sends its content to `windows-agent` over A2A.
3. Windows calls `save_file`, writing `received/<collaboration-id>/sales-data.csv` in its own local workspace, then calls `read_file` to verify it.
4. Windows analyzes the data, Mac independently analyzes and critiques it, Windows revises, and Mac writes a final consensus.
5. A final A2A stage makes Windows read its saved copy again. The separate Windows verification script checks the file directly.

## Setup

On Mac, use `main`; on Windows, use `windows`. On both machines:

```bash
npm ci
Copy .env.example to .env and set the peer IP addresses.
```

Keep `A2A_API_TOKEN` and the matching peer token blank on a trusted isolated demo network, or set matching secure values. Start Ollama and then `npm run dev` on both computers.

## Preflight tests

Run on both machines:

```bash
npm test
npm run demo:dry-run
npm run build
```

## Run

From Mac:

```bash
npm run demo:a2a
```

The command stops immediately if any stage omits its required marker. On success it writes a consensus report beneath `src/mastra/public/workspace/demo-output/` and prints the collaboration ID.

On Windows, prove that the transferred file exists independently of the model response:

```bash
npm run demo:verify-workspace -- <collaboration-id>
```

The verifier parses the received CSV and requires four rows, total revenue 3600, highest units Gamma, highest revenue Beta, highest return rate Delta (20%), and lowest return rate Gamma (2%).
