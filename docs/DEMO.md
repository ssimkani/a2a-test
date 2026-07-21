# Decentralized Edge AI Kill-Switch Demonstration

## Demonstration message

> The original compute node was lost, but the replicated workflow checkpoint survived and another node completed the intelligence product.

This guide explains how to rehearse the demonstration, record it, and present it when the audience network cannot be accessed.

Use only fictional, unclassified transcript data.

## What the demonstration proves

Node Alpha begins a three-step SALUTE workflow:

1. Extract Size, Activity, and Location (SAL).
2. Extract Unit, Time, and Equipment (UTE).
3. Draft a formal SITREP.

Alpha writes each completed checkpoint to its local OrbitDB replica. OrbitDB replicates the state to Bravo. Alpha is then stopped. Bravo detects the stale heartbeat, claims the task, injects the replicated checkpoint into a new Mastra workflow run, skips work already completed by Alpha, and finishes the SITREP.

This is external-checkpoint recovery: Bravo starts a new Mastra run using replicated state. It does not resume Alpha's in-memory process.

## Roles and expected state

| Value | Node Alpha (Mac) | Node Bravo (Windows) |
| --- | --- | --- |
| Branch | `main` | `windows` |
| `NODE_ID` | `Node Alpha` | `Node Bravo` |
| OrbitDB data directory | `.orbitdb/node-alpha` | `.orbitdb/node-bravo` |
| `KILL_SWITCH_TASK_ID` | Same value | Same value |
| OrbitDB database address | Same value | Same value |
| libp2p peer ID | Unique | Unique |

The database address must match. The peer IDs must be different.

## Rehearse before recording

Run the automated preflight on each machine:

```bash
npm install
npm run framework:test
```

This validates the dependency tree, TypeScript, repository tests, production build, OrbitDB replication, native Ollama inference, and the Mastra dev-server lifecycle.

Confirm Ollama has the configured model:

```bash
ollama pull qwen3.5:2b
```

Do not delete `.orbitdb` between normal rehearsals. Use a new task ID instead:

```dotenv
KILL_SWITCH_TASK_ID=sitrep-demo-002
```

Use the exact same task ID in Alpha's and Bravo's local `.env` files. The `.env` files are not synchronized by Git.

## Configure the rehearsal

On Alpha's `.env`:

```dotenv
NODE_ID=Node Alpha
ORBITDB_DATA_DIR=.orbitdb/node-alpha
ORBITDB_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4301
ORBITDB_DATABASE_ADDRESS=
ORBITDB_BOOTSTRAP_MULTIADDRS=
KILL_SWITCH_TASK_ID=sitrep-demo-002
KILL_SWITCH_PAUSE_AFTER_SAL_MS=30000
```

On Bravo's `.env`, use the database address and current Alpha peer multiaddress printed by Alpha:

```dotenv
NODE_ID=Node Bravo
ORBITDB_DATA_DIR=.orbitdb/node-bravo
ORBITDB_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4301
ORBITDB_DATABASE_ADDRESS=/orbitdb/<same-address-printed-by-alpha>
ORBITDB_BOOTSTRAP_MULTIADDRS=/ip4/<alpha-ip>/tcp/4301/p2p/<current-alpha-peer-id>
KILL_SWITCH_TASK_ID=sitrep-demo-002
KILL_SWITCH_PAUSE_AFTER_SAL_MS=0
```

After Alpha restarts, its libp2p peer identity may change in the current prototype. Always copy the newly printed Alpha multiaddress into Bravo's `.env` before starting Bravo. Do not use an old peer ID.

## Live rehearsal sequence

### 1. Start Alpha

On the Mac, run:

```bash
git switch main
npm run kill-switch:watch
```

Record Alpha's:

```text
Database address: /orbitdb/...
Share this peer multiaddress: /ip4/<alpha-ip>/tcp/4301/p2p/<peer-id>
```

### 2. Start Bravo

On Windows PowerShell, run:

```powershell
git switch windows
npm run kill-switch:watch
```

Wait for:

```text
Connected to peer ...
Database address: /orbitdb/<same-address-as-alpha>
REPLICATION PEER JOINED
```

If Bravo reports `EncryptionFailedError`, its bootstrap multiaddress contains an old Alpha peer ID. Stop Bravo, update the value from Alpha's current startup banner, and restart Bravo.

### 3. Start the task on Alpha

In Alpha's watcher terminal, type:

```text
start
```

The watcher command alone only waits; it does not create a task. Alternatively, after Bravo is ready, Alpha can start automatically with:

```bash
npm run kill-switch:start
```

Do not run two Alpha watchers against the same `.orbitdb/node-alpha` directory.

### 4. Capture the checkpoint

Alpha should print:

```text
STARTING KILL-SWITCH TASK sitrep-demo-002
STEP 1 START: extracting Size, Activity, Location
STEP 1 COMPLETE. SAL checkpoint committed to local OrbitDB.
CHECKPOINT REPLICATED. KILL NODE ALPHA NOW.
```

This is the key moment. The 30-second pause exists so the presenter can show the SAL checkpoint and stop Alpha before it completes the remaining steps.

### 5. Simulate destruction

Stop Alpha with `Ctrl+C` immediately after the checkpoint banner. Leave Bravo running.

### 6. Capture Bravo's failover

Bravo should print:

```text
DETECTED Node Alpha TIMEOUT
OWNERSHIP TRANSFER COMMITTED: Node Alpha -> Node Bravo
Injecting OrbitDB checkpoint ... SAL=true
Skipping Step 1
STEP 2 START: extracting Unit, Time, Equipment
STEP 2 COMPLETE
STEP 3 START: drafting formal SITREP
STEP 3 COMPLETE. Task marked COMPLETED in OrbitDB.
```

End on the final SITREP and the completed OrbitDB state.

## Recording plan

Use a prerecorded video as the primary presentation when the audience network cannot be accessed. A live network demo is optional, not the main plan.

Record a two- to three-minute split-screen video:

1. Alpha and Bravo startup banners.
2. Same OrbitDB database address and different peer IDs.
3. Alpha starting the task.
4. Alpha's SAL extraction and checkpoint banner.
5. Alpha being stopped.
6. Bravo detecting the timeout and claiming the task.
7. Bravo skipping Step 1 and completing Steps 2 and 3.
8. Final SITREP and completed status.

Use large terminal text, crop unnecessary paths, and hide API tokens or other credentials. Keep the fictional transcript visible long enough for the audience to understand the input.

## Screenshots to keep as evidence

Capture these stills in addition to the video:

1. Both nodes connected to the same OrbitDB address.
2. Alpha's `STEP 1 COMPLETE` SAL checkpoint.
3. Alpha stopped or disconnected.
4. Bravo's timeout detection.
5. Bravo's ownership transfer.
6. Bravo's final SITREP and `status=completed`.

Name them in order, for example:

```text
01-connected.png
02-alpha-sal-checkpoint.png
03-alpha-failed.png
04-bravo-timeout.png
05-bravo-claim.png
06-final-sitrep.png
```

## Narration script

“Alpha begins with a fictional radio transcript and extracts the first SALUTE fields. That checkpoint is immediately committed to the local OrbitDB replica and replicated to Bravo. Alpha is now unavailable. Bravo observes that Alpha's heartbeat has expired, claims ownership of the task, and starts a new Mastra run using the replicated checkpoint. Because SAL already exists, Bravo skips that work, completes the remaining extraction, and produces the final SITREP. The device was lost; the workflow and mission data were not.”

## Offline briefing package

Bring these files locally so no venue network is required:

- `kill-switch-demo.mp4`
- `01-connected.png` through `06-final-sitrep.png`
- `DEMO.md`
- A one-page architecture diagram
- A copy of the fictional transcript
- The final SITREP output

The recommended presentation order is video first, screenshots second, and a live local replay only if the environment permits it.

## Important distinction

The current workflow demonstrates failover redundancy. Both nodes can access the same replicated workflow state, and Bravo can complete work after Alpha fails. It is not yet a SIGINT/GEOINT specialization demonstration. A future version could replicate separate SIGINT and GEOINT artifacts and add a fusion step, but the current SALUTE workflow is the safer baseline for a recorded briefing.
