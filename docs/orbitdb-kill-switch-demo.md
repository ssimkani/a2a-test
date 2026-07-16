# OrbitDB + Mastra Kill-Switch Demonstration

## Executive purpose

This demonstration shows that a mission-relevant AI workflow can survive the loss of its original edge-compute node without reachback to C2 or CONUS. Node Alpha begins processing a fictional radio transcript, commits a structured intermediate checkpoint to its local OrbitDB replica, and then disappears. Node Bravo detects the expired heartbeat, claims the replicated task, injects the checkpoint into a new Mastra workflow run, skips work already completed by Alpha, and produces the final SITREP with its own local Ollama model.

One-line message for leadership:

> The device was lost; the workflow and mission data were not.

This is a prototype demonstration, not an accredited operational system. Use only fictional or appropriately approved unclassified data.

## What the audience should see

```mermaid
sequenceDiagram
    participant A as Node Alpha (MacBook)
    participant OA as Alpha OrbitDB
    participant OB as Bravo OrbitDB
    participant B as Node Bravo (Windows)

    A->>A: Mastra Step 1 extracts SAL
    A->>OA: Commit SAL + heartbeat
    OA-->>OB: Merkle-CRDT replication over libp2p
    Note over A: Presenter kills Alpha
    B->>OB: Watch every 2 seconds
    B->>B: Heartbeat older than 5 seconds
    B->>OB: Claim task ownership
    B->>B: Start Mastra with replicated state
    B->>B: Step 1 skips; SAL already exists
    B->>B: Step 2 extracts UTE
    B->>B: Step 3 drafts final SITREP
    B->>OB: Commit completed status + SITREP
```

The existing A2A collaboration demo remains registered and unchanged. This kill-switch path is an additional demonstration.

## Design choices

### OrbitDB replaces the requested GraphQL schema

OrbitDB is not a GraphQL database and does not apply a `.graphql` collection schema. The executable collection schema is [workflow-state.ts](../src/mastra/orbitdb/workflow-state.ts), enforced with Zod on every read and write. The OrbitDB documents database is configured with `taskId` as its document index, which makes it the logical primary key.

| Field | Type | Purpose |
| --- | --- | --- |
| `taskId` | string | Stable OrbitDB document key |
| `assignedNode` | string | Current workflow owner |
| `status` | `pending`, `in_progress`, or `completed` | Workflow lifecycle |
| `lastHeartbeat` | integer milliseconds | Demo failover lease |
| `rawTranscript` | string | Original input |
| `extractedSAL` | structured object or `null` | Size, Activity, Location checkpoint |
| `extractedUTE` | structured object or `null` | Unit, Time, Equipment checkpoint |
| `finalSitrep` | string or `null` | Final product |
| `revision`, `updatedAt`, `claimedFrom` | metadata | Demo traceability and terminal storytelling |

The prototype replicates structured workflow state, not private model chain-of-thought.

### Resume semantics

Bravo starts a new Mastra run with the OrbitDB document supplied as both `inputData` and `initialState`. This is external-checkpoint recovery rather than resuming Alpha's in-memory process or reusing its Mastra run ID. Every step re-reads OrbitDB before doing work:

- Existing SAL means Step 1 returns it without calling Ollama.
- Existing UTE means Step 2 returns it without calling Ollama.
- An existing completed SITREP means Step 3 returns it without calling Ollama.
- A newly generated result is committed to OrbitDB before the step proceeds.

### One OrbitDB owner process per node

The TypeScript watcher owns that machine's persistent OrbitDB/Helia directories and invokes the registered Mastra workflow. Run it beside the Mastra Studio/A2A server, but do not launch a second kill-switch watcher using the same `ORBITDB_DATA_DIR`. Multiple LevelDB-owning processes pointed at one directory can contend for file locks.

## Files added

- `src/mastra/orbitdb/workflow-state.ts` — collection schema and types
- `src/mastra/orbitdb/client.ts` — persistent Helia/libp2p/OrbitDB replica
- `src/mastra/agents/kill-switch-sitrep-agent.ts` — native Ollama Mastra agent
- `src/mastra/workflows/kill-switch-workflow.ts` — three idempotent steps
- `src/mastra/scripts/watcher.ts` — heartbeat watcher, ownership claim, and Alpha launcher
- `src/mastra/scripts/failover-policy.ts` — testable timeout policy
- `docs/sample-radio-transcript.txt` — fictional demonstration input

## Prerequisites on both machines

1. Node.js 22.13.0 or newer. OrbitDB 4 requires Node.js 22 or newer.
2. Git and this repository checked out on each machine.
3. Native [Ollama](https://ollama.com/) installed.
4. The same Ollama model pulled on each node. The template uses `qwen3.5:2b` because that is already used by this project.
5. TCP connectivity from Bravo to Alpha on the chosen OrbitDB port. The template uses TCP 4301.
6. System clocks synchronized. The five-second demo lease uses `Date.now()` values replicated between machines.

Install and verify:

```bash
npm install
ollama pull qwen3.5:2b
npm test
npm run build
```

Keep Ollama running on each machine. Depending on the installation, launching the Ollama desktop application starts the service. Otherwise:

```bash
ollama serve
```

## MacBook setup — Node Alpha

### 1. Select the local branch and configure the environment

```bash
git switch main
cp .env.example .env
```

Set these values in `.env`:

```dotenv
NODE_ID=Node Alpha
ORBITDB_DATA_DIR=.orbitdb/node-alpha
ORBITDB_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4301
ORBITDB_DATABASE_NAME=kill-switch-workflow-state
ORBITDB_DATABASE_ADDRESS=
ORBITDB_BOOTSTRAP_MULTIADDRS=

OLLAMA_BASE_URL=http://127.0.0.1:11434/api
KILL_SWITCH_OLLAMA_MODEL=qwen3.5:2b
KILL_SWITCH_TIMEOUT_MS=5000
KILL_SWITCH_PAUSE_AFTER_SAL_MS=30000
KILL_SWITCH_TASK_ID=sitrep-demo-001
KILL_SWITCH_TRANSCRIPT_FILE=docs/sample-radio-transcript.txt
```

Allow incoming connections for Node.js if macOS displays a firewall prompt.

### 2. Start the existing Mastra application

This keeps Studio and the existing A2A demo available:

```bash
npm run dev
```

Mastra Studio remains at `http://localhost:4111`.

### 3. Start Alpha's kill-switch runtime

In a separate terminal:

```bash
npm run kill-switch:watch
```

Record the two important lines:

```text
[OrbitDB][Node Alpha] Database address: /orbitdb/...
[OrbitDB][Node Alpha] Share this peer multiaddress: /ip4/<ALPHA-IP>/tcp/4301/p2p/<PEER-ID>
```

Choose the multiaddress containing the Mac's peer-network IPv4 address, not `127.0.0.1`. Leave this process running. Do not type `start` yet.

## Windows setup — Node Bravo

### 1. Select the Windows branch and configure the environment

In PowerShell:

```powershell
git switch windows
Copy-Item .env.example .env
npm install
```

Use the exact database address printed by Alpha. Construct the bootstrap multiaddress from the usable Alpha address printed in its terminal:

```dotenv
NODE_ID=Node Bravo
ORBITDB_DATA_DIR=.orbitdb/node-bravo
ORBITDB_LISTEN_ADDRESSES=/ip4/0.0.0.0/tcp/4301
ORBITDB_DATABASE_NAME=kill-switch-workflow-state
ORBITDB_DATABASE_ADDRESS=/orbitdb/<COPY-EXACTLY-FROM-ALPHA>
ORBITDB_BOOTSTRAP_MULTIADDRS=/ip4/<ALPHA-PEER-IP>/tcp/4301/p2p/<ALPHA-PEER-ID>

OLLAMA_BASE_URL=http://127.0.0.1:11434/api
KILL_SWITCH_OLLAMA_MODEL=qwen3.5:2b
KILL_SWITCH_TIMEOUT_MS=5000
KILL_SWITCH_PAUSE_AFTER_SAL_MS=0
KILL_SWITCH_TASK_ID=sitrep-demo-001
KILL_SWITCH_TRANSCRIPT_FILE=docs/sample-radio-transcript.txt
```

Bravo does not need `KILL_SWITCH_PAUSE_AFTER_SAL_MS`; it skips SAL after takeover.

### 2. Verify the network path

On Windows:

```powershell
Test-NetConnection <ALPHA-PEER-IP> -Port 4301
```

If Windows will also accept inbound OrbitDB connections, create a narrowly scoped firewall rule for the private network profile:

```powershell
New-NetFirewallRule -DisplayName "OrbitDB Kill Switch Demo" -Direction Inbound -Protocol TCP -LocalPort 4301 -Action Allow -Profile Private
```

Use the existing P2P interface and its actual profile. Do not open this demo port on an untrusted public network.

### 3. Start Bravo

The existing Windows Mastra/A2A application may run in one terminal:

```powershell
npm run dev
```

Start the kill-switch watcher in another:

```powershell
npm run kill-switch:watch
```

Before proceeding, verify logs resembling:

```text
[OrbitDB][Node Bravo] Connected to peer ...
[OrbitDB][Node Bravo] Database address: /orbitdb/<same-address-as-alpha>
[OrbitDB][Node Bravo] REPLICATION PEER JOINED: ...
```

Alpha may also print `REPLICATION PEER JOINED`.

## Live demonstration choreography

### Normal first run

1. Put Alpha's kill-switch terminal on the left and Bravo's on the right.
2. Confirm both display the same OrbitDB database address.
3. In Alpha's watcher terminal, type:

   ```text
   start
   ```

4. Alpha should show Step 1, periodic heartbeat writes, and then:

   ```text
   [Mastra][Node Alpha] STEP 1 COMPLETE. SAL checkpoint committed to local OrbitDB.
   [DEMO][Node Alpha] CHECKPOINT REPLICATED. KILL NODE ALPHA NOW.
   ```

5. Verify Bravo has printed a CRDT update for `sitrep-demo-001:in_progress@Node Alpha`.
6. Terminate Alpha's kill-switch process during the 30-second hold. `Ctrl+C` is the safest rehearsal method. Closing the terminal or stopping the Mac process more abruptly is more theatrical but can make repeated rehearsals less predictable.
7. After the last replicated heartbeat is older than five seconds, Bravo should show:

   ```text
   [Node Bravo] DETECTED Node Alpha TIMEOUT. CLAIMING TASK sitrep-demo-001...
   [OrbitDB][Node Bravo] OWNERSHIP TRANSFER COMMITTED: Node Alpha -> Node Bravo
   [Mastra][Node Bravo] Skipping Step 1 (extractSAL): SAL data already exists in replicated memory.
   [Mastra][Node Bravo] STEP 2 START: extracting Unit, Time, Equipment with local Ollama.
   [Mastra][Node Bravo] STEP 3 COMPLETE. Task marked COMPLETED in OrbitDB.
   ```

8. Bravo prints the final SITREP between obvious terminal separators.

If you want to start Alpha immediately on a later rehearsal where Bravo already has the saved database address, use:

```bash
npm run kill-switch:start
```

### Reset between rehearsals

OrbitDB state is intentionally persistent. Change `KILL_SWITCH_TASK_ID` for each rehearsal, for example:

```dotenv
KILL_SWITCH_TASK_ID=sitrep-demo-002
```

Use the same new ID on both machines. Changing the task ID is safer than deleting database directories and preserves evidence from prior runs.

## Presenter talk track

### 20-second version

> Alpha is performing local exploitation with no cloud dependency. It has completed half of the structured extraction and replicated that checkpoint directly to Bravo. We now remove Alpha. Bravo detects the expired lease, claims the workflow, proves idempotence by skipping completed work, and finishes the intelligence product using its own local model. We lost compute, not workflow state.

### Points worth emphasizing

- Both Ollama models execute locally.
- OrbitDB replicates state directly between edge nodes using libp2p.
- The raw input, ownership, heartbeat, intermediate products, and final product survive locally.
- Idempotent steps prevent unnecessary repeated inference after failover.
- The A2A collaboration capability remains available as a separate pattern; this demonstration focuses on durable shared workflow state.

## Recording and photography plan

### Recommended screen layout

- Left half: Alpha watcher terminal, title bar visibly labeled `NODE ALPHA — MAC`.
- Right half: Bravo watcher terminal, title bar visibly labeled `NODE BRAVO — WINDOWS`.
- Use a large monospace font and dark background.
- Hide `.env`, tokens, usernames, unrelated notifications, and network details that should not be shown.
- Record at 1080p or higher so the terminal text remains readable in a briefing room.

### Capture these four moments

1. Both replicas online with the same database address and a peer-join message.
2. Alpha's `STEP 1 COMPLETE` and `CHECKPOINT REPLICATED` banner.
3. Bravo's timeout, claim, and `Skipping Step 1` messages in the same frame as the dead Alpha terminal.
4. Bravo's `COMPLETED` status and final SITREP.

On macOS, QuickTime Player can record the screen and `Shift-Command-5` opens capture controls. On Windows, OBS Studio is the most controllable cross-platform option; Xbox Game Bar may be sufficient for a terminal capture. Rehearse the full event before recording and keep a separate clean backup recording.

### Suggested briefing slide sequence

1. Operational problem: DDIL reachback and fragile single-node processing.
2. Architecture: specialized local models plus replicated mission/workflow state.
3. Live or recorded kill-switch sequence.
4. Evidence: Alpha checkpoint, Bravo claim, idempotent skip, final product.
5. Next steps and production-hardening requirements.

## Troubleshooting

### Bravo cannot open the database

- Confirm `ORBITDB_DATABASE_ADDRESS` is copied exactly, including `/orbitdb/`.
- Confirm `ORBITDB_BOOTSTRAP_MULTIADDRS` ends with Alpha's `/p2p/<peer-id>`.
- Start Alpha before Bravo for Bravo's first synchronization.
- Verify `Test-NetConnection <ALPHA-IP> -Port 4301` succeeds.
- Check macOS and Windows firewalls and confirm the selected IP belongs to the intended P2P interface.

### No `REPLICATION PEER JOINED` message

- Confirm both nodes opened the same database address.
- Confirm the bootstrap multiaddress uses a reachable address, not loopback.
- Confirm both terminals say `Connected to peer`.
- Do not proceed to the kill until Bravo prints the task's CRDT update.

### A watcher reports a LevelDB lock

Only one kill-switch process may use a given `ORBITDB_DATA_DIR`. Stop the extra watcher. The Mastra dev server can remain running because it does not open OrbitDB until this workflow is executed there; launch kill-switch runs from the watcher for this demonstration.

### Bravo claims Alpha while Alpha is still alive

- Synchronize both system clocks.
- Verify Alpha prints a heartbeat approximately every two seconds during Ollama inference and the demonstration pause.
- Raise `KILL_SWITCH_TIMEOUT_MS` to `10000` for slower or less predictable networks. Five seconds is intentionally aggressive for stage timing.

### Ollama fails or returns invalid structured output

- Run `ollama list` and confirm `KILL_SWITCH_OLLAMA_MODEL` exists on that machine.
- Confirm the native API is reachable at `OLLAMA_BASE_URL`.
- Test a larger local model if the selected small model cannot consistently satisfy the SAL/UTE schema.
- The prompts are deliberately marked as dummy scaffolding; replace them with approved prompts before the briefing.

### The task is already completed

Change `KILL_SWITCH_TASK_ID` on both machines. Persistent completion is expected and demonstrates durability.

## Prototype boundaries and production hardening

State these boundaries plainly if asked:

- OrbitDB replication is eventually consistent. It does not provide an instantaneous globally consistent lease.
- The demo uses wildcard OrbitDB write access so independently created Alpha and Bravo identities can both update the database. Production must use explicit approved identities and key management.
- Data-at-rest and payload encryption, identity authorization, audit export, zeroization, and classification controls are outside this prototype.
- A network partition can create split-brain ownership if Alpha remains alive but disconnected. Production requires fencing, a deterministic lease/epoch policy, or quorum appropriate to the mission topology.
- The five-second timeout is for a visible live demonstration, not a validated operational setting.
- Wall-clock leases depend on time synchronization. A production protocol should use a more robust logical-clock/epoch design.
- Run the workflow with fictional or properly approved data until security controls and accreditation are complete.

Recommended next increments:

1. Replace wildcard writes with explicit OrbitDB identities and signed node enrollment.
2. Add encrypted replication and protected local key storage.
3. Add claim epochs/fencing tokens and split-brain reconciliation tests.
4. Test power loss, process kill, network partition, delayed replication, clock skew, and node rejoin.
5. Add an operator UI showing node health, task lineage, checkpoint provenance, and final-product approval.
6. Measure time-to-checkpoint, replication latency, failover detection, recovery time, model latency, and data-loss window.

## Reference documentation

- [OrbitDB repository and current installation guidance](https://github.com/orbitdb/orbitdb)
- [OrbitDB connecting peers](https://github.com/orbitdb/orbitdb/blob/main/docs/CONNECTING_PEERS.md)
- [OrbitDB access controllers](https://github.com/orbitdb/orbitdb/blob/main/docs/ACCESS_CONTROLLERS.md)
- [Mastra documentation](https://mastra.ai/llms.txt)
- [Ollama](https://ollama.com/)
