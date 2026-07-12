# DefraDB workspace rollout

This project can use a local DefraDB node as the Mastra agent workspace. Mastra framework state remains in the LibSQL/DuckDB stores configured in `src/mastra/index.ts`.

## 1. Pin one DefraDB version

Install the same exact DefraDB release on the Mac and Windows. Do not mix v0.20.x with v1.0 release candidates because their database and CLI contracts differ.

Verify on both machines:

```bash
defradb version
```

Record the selected version in deployment configuration before continuing.

## 2. Start each node

Run a node on the Mac and a separate node on the Windows computer:

```bash
defradb start \
  --rootdir ~/.defradb-a2a \
  --url 127.0.0.1:9181 \
  --p2paddr /ip4/0.0.0.0/tcp/9171
```

Keep port 9181 bound to localhost. Permit TCP 9171 only across the network path between the Mac and Windows.

## 3. Configure the application

Start with local workspace reads while installing and migrating DefraDB:

```dotenv
WORKSPACE_BACKEND=local
DEFRA_DB_URL=http://127.0.0.1:9181
DEFRA_DB_GRAPHQL_PATH=/api/v0/graphql
DEFRA_DB_NODE_ID=macbook
DEFRA_DB_REQUEST_TIMEOUT_MS=10000
DEFRA_DB_MAX_FILE_BYTES=10485760
```

Use a distinct `DEFRA_DB_NODE_ID=windows` on the Windows computer.

Install the schema on both nodes:

```bash
npm run defradb:bootstrap
```

## 4. Connect and replicate

Get peer information on both machines:

```bash
defradb client p2p info --url 127.0.0.1:9181
```

Connect each node to the other node's P2P multiaddress. Configure active replication for `WorkspaceEntry` in both directions using the command supported by the pinned DefraDB version. For v0.20.x this is:

```bash
defradb client p2p replicator set -c WorkspaceEntry '<peer-info-json>'
```

If the selected version does not persist replicators across restart, run the replicator command from the DefraDB service startup hook.

## 5. Import and verify the Mac workspace

With agents stopped or writes otherwise paused:

```bash
npm run defradb:migrate
npm run defradb:verify
```

The default import source is `src/mastra/public/workspace`. Override it with `LOCAL_WORKSPACE_PATH` when necessary.

Wait for replication, then run the verification script on the Windows computer against a copy of the expected workspace or query `WorkspaceEntry` directly.

## 6. Cut over

Set this on each machine and restart Mastra:

```dotenv
WORKSPACE_BACKEND=defradb
```

Run an A2A exchange that sends a workspace file. Confirm its transcript exists in DefraDB on both machines and that no new file appears in the local workspace.

To roll back, set `WORKSPACE_BACKEND=local` and restart Mastra. Do not remove the original workspace until the rollback window has passed.
