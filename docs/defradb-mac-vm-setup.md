# Configure DefraDB on the Mac and VM

This runbook configures one local DefraDB node on the MacBook and one on the Linux VM, connects them over DefraDB's P2P network, replicates the `WorkspaceEntry` collection in both directions, migrates the existing Mac workspace, and switches both Mastra agents to DefraDB-backed workspaces.

The project integration currently targets the DefraDB v0.20.x API, including the `/api/v0/graphql` endpoint. Do not use a v1 release candidate with these instructions without first updating and testing the client, schema, and CLI commands. The v1 release candidate contains breaking changes from v0.20.x.

References:

- [DefraDB v0.20 getting started](https://docs.source.network/defradb/0.20.0/)
- [DefraDB P2P guide](https://docs.source.network/defradb/guides/peer-to-peer/)
- [DefraDB releases](https://github.com/sourcenetwork/defradb/releases)

## Values used in this guide

Replace these placeholders everywhere they appear:

| Placeholder | Meaning | Example |
| --- | --- | --- |
| `<DEFRA_VERSION>` | Exact DefraDB release installed on both systems | `v0.20.0` |
| `<MAC_IP>` | Mac IP reachable from the VM | `192.168.21.100` |
| `<VM_IP>` | VM IP reachable from the Mac | `192.168.21.220` |
| `<MAC_PEER_ID>` | Peer ID printed by the Mac DefraDB node | `12D3Koo...` |
| `<VM_PEER_ID>` | Peer ID printed by the VM DefraDB node | `12D3Koo...` |
| `<PROJECT_DIR>` | Absolute project directory on each machine | `/Users/seena/repos/a2a-test` |

The ports in this guide are:

- `9181/tcp`: local DefraDB HTTP and GraphQL API; keep bound to `127.0.0.1`.
- `9171/tcp`: DefraDB P2P traffic; expose only between the Mac and VM.
- `4111/tcp`: the existing Mastra/A2A server.

## 1. Confirm the Mac and VM can reach each other

On the Mac, find the current address. `en0` is normally Wi-Fi, but use the interface connected to the VM network:

```bash
ipconfig getifaddr en0
```

On the VM, find its address:

```bash
hostname -I
```

Confirm basic connectivity from the Mac:

```bash
ping -c 3 <VM_IP>
```

Confirm basic connectivity from the VM:

```bash
ping -c 3 <MAC_IP>
```

Record the two addresses before continuing. If the IPs are assigned dynamically, reserve them in the router or use stable VPN addresses.

## 2. Select and install the same DefraDB release

Open the [DefraDB releases page](https://github.com/sourcenetwork/defradb/releases), locate the chosen v0.20.x release, and download the correct precompiled executable for each architecture.

Check the Mac architecture:

```bash
uname -s
uname -m
```

Typical Mac results are `Darwin arm64` for Apple Silicon or `Darwin x86_64` for an Intel Mac.

Check the VM architecture:

```bash
uname -s
uname -m
```

Typical VM results are `Linux x86_64` or `Linux aarch64`.

After extracting the downloaded archive, install the binary on the Mac:

```bash
sudo install -m 0755 /path/to/extracted/defradb /usr/local/bin/defradb
defradb version
```

Install it on the VM:

```bash
sudo install -m 0755 /path/to/extracted/defradb /usr/local/bin/defradb
defradb version
```

Stop here unless both commands report the exact same version:

```text
Mac version = VM version = <DEFRA_VERSION>
```

Do not copy an existing `~/.defradb` data directory between different DefraDB versions.

## 3. Deploy the current project code to both machines

The VM must contain the same implementation as the Mac, including:

```text
src/mastra/defradb/client.ts
src/mastra/defradb/filesystem.ts
src/mastra/defradb/path-utils.ts
src/mastra/defradb/schema.graphql
scripts/defradb-bootstrap.mjs
scripts/defradb-migrate-workspace.mjs
scripts/defradb-verify-workspace.mjs
scripts/lib/defradb.mjs
```

Deploy the same Git commit to the VM using the project's existing deployment method. Then install Node dependencies on both systems:

```bash
cd <PROJECT_DIR>
npm install
```

Keep `.env` local to each machine. Do not copy API tokens or other secrets through Git.

## 4. Configure the Mac environment

In the Mac project directory, add the following to `.env`. Keep the backend set to `local` until migration and replication have been verified:

```dotenv
WORKSPACE_BACKEND=local
DEFRA_DB_URL=http://127.0.0.1:9181
DEFRA_DB_GRAPHQL_PATH=/api/v0/graphql
DEFRA_DB_NODE_ID=macbook
DEFRA_DB_REQUEST_TIMEOUT_MS=10000
DEFRA_DB_MAX_FILE_BYTES=10485760
```

Retain the existing Mac-to-VM A2A settings:

```dotenv
VM_MASTRA_BASE_URL=http://<VM_IP>:4111
VM_A2A_AGENT_ID=vm-agent
VM_MASTRA_API_PREFIX=/api
VM_A2A_TOKEN=<the-VM-token-if-enabled>
```

## 5. Configure the VM environment

In the VM project directory, add the following to `.env`:

```dotenv
WORKSPACE_BACKEND=local
DEFRA_DB_URL=http://127.0.0.1:9181
DEFRA_DB_GRAPHQL_PATH=/api/v0/graphql
DEFRA_DB_NODE_ID=vm
DEFRA_DB_REQUEST_TIMEOUT_MS=10000
DEFRA_DB_MAX_FILE_BYTES=10485760
```

Use `DEFRA_DB_NODE_ID=vm`, not `macbook`. The writer node ID is stored with workspace changes for diagnostics.

Retain the VM's existing A2A settings for reaching the Mac agent.

## 6. Start a new DefraDB node on the Mac

For initial setup, run DefraDB in a dedicated foreground terminal so its logs remain visible:

```bash
defradb start \
  --rootdir ~/.defradb-a2a \
  --url 127.0.0.1:9181 \
  --p2paddr /ip4/0.0.0.0/tcp/9171
```

The first start creates the Mac node's persistent peer identity under `~/.defradb-a2a`. Back up this directory later; do not share its private keys.

Look for log lines indicating:

```text
Created LibP2P host
Providing HTTP API at http://127.0.0.1:9181
Providing GraphQL endpoint at http://127.0.0.1:9181/api/v0/graphql
```

In another Mac terminal, verify the node:

```bash
defradb client p2p info --url 127.0.0.1:9181
defradb client schema describe --url 127.0.0.1:9181
```

Save the full peer-info JSON and record its peer ID as `<MAC_PEER_ID>`:

```bash
defradb client p2p info --url 127.0.0.1:9181 > mac-peer-info.json
```

## 7. Start a new DefraDB node on the VM

On the VM, run:

```bash
defradb start \
  --rootdir ~/.defradb-a2a \
  --url 127.0.0.1:9181 \
  --p2paddr /ip4/0.0.0.0/tcp/9171
```

In another VM terminal, verify it and save its peer information:

```bash
defradb client p2p info --url 127.0.0.1:9181
defradb client p2p info --url 127.0.0.1:9181 > vm-peer-info.json
```

Record the peer ID as `<VM_PEER_ID>`.

The Mac and VM must have different peer IDs. If they are identical, the same DefraDB root directory or peer key was copied to both machines. Stop both nodes and create a fresh root directory for one of them.

## 8. Restrict the P2P firewall rules

Do not expose port 9181 to the LAN or internet. The Mastra process connects to DefraDB through localhost on each machine.

If the VM uses UFW, allow DefraDB P2P traffic only from the Mac:

```bash
sudo ufw allow from <MAC_IP> to any port 9171 proto tcp
sudo ufw status
```

Configure the Mac firewall or network firewall to permit inbound TCP 9171 from `<VM_IP>` only.

With both nodes running, test from the Mac:

```bash
nc -vz <VM_IP> 9171
```

Test from the VM:

```bash
nc -vz <MAC_IP> 9171
```

Both checks must succeed before configuring replication.

## 9. Install the workspace schema on both nodes

On the Mac:

```bash
cd <PROJECT_DIR>
npm run defradb:bootstrap
```

On the VM:

```bash
cd <PROJECT_DIR>
npm run defradb:bootstrap
```

Confirm the collection exists on both nodes:

```bash
defradb client schema describe --url 127.0.0.1:9181 --name WorkspaceEntry
```

The schema definitions must match. Do not begin replication with different `WorkspaceEntry` schemas.

## 10. Restart both nodes as explicit peers

Stop the foreground DefraDB process on each machine with `Ctrl-C`.

Restart the Mac and tell it how to reach the VM:

```bash
defradb start \
  --rootdir ~/.defradb-a2a \
  --url 127.0.0.1:9181 \
  --p2paddr /ip4/0.0.0.0/tcp/9171 \
  --peers /ip4/<VM_IP>/tcp/9171/p2p/<VM_PEER_ID>
```

Restart the VM and tell it how to reach the Mac:

```bash
defradb start \
  --rootdir ~/.defradb-a2a \
  --url 127.0.0.1:9181 \
  --p2paddr /ip4/0.0.0.0/tcp/9171 \
  --peers /ip4/<MAC_IP>/tcp/9171/p2p/<MAC_PEER_ID>
```

Check both logs for a successful peer connection. Re-run `p2p info` to ensure the persistent peer IDs did not change.

## 11. Configure active replication in both directions

Active replication explicitly pushes the entire `WorkspaceEntry` collection to the other node.

Copy `vm-peer-info.json` from the VM to a temporary safe location on the Mac. On the Mac, run:

```bash
defradb client p2p replicator set \
  --url 127.0.0.1:9181 \
  -c WorkspaceEntry \
  "$(cat vm-peer-info.json)"
```

Copy `mac-peer-info.json` from the Mac to a temporary safe location on the VM. On the VM, run:

```bash
defradb client p2p replicator set \
  --url 127.0.0.1:9181 \
  -c WorkspaceEntry \
  "$(cat mac-peer-info.json)"
```

If the pinned v0.20.x patch release expects only a peer ID instead of the complete peer-info JSON, use the exact form shown by `defradb client p2p replicator set --help`:

```bash
defradb client p2p replicator set --help
```

Some v0.20-era releases do not persist replicator configuration across restarts. Until restart persistence is confirmed for the pinned version, treat both `replicator set` commands as required node-startup steps.

## 12. Migrate the existing Mac workspace

Leave both Mastra agents stopped, or otherwise prevent workspace writes during migration.

On the Mac, confirm `.env` still contains:

```dotenv
WORKSPACE_BACKEND=local
```

Create a backup of the existing source workspace:

```bash
cd <PROJECT_DIR>
tar -czf "$HOME/a2a-workspace-before-defradb-$(date +%Y%m%d-%H%M%S).tar.gz" \
  src/mastra/public/workspace
```

Import the workspace into the Mac DefraDB node:

```bash
npm run defradb:migrate
```

Verify every local file against its DefraDB SHA-256 hash:

```bash
npm run defradb:verify
```

Both commands must finish successfully before cutover.

If the runtime workspace lives somewhere other than `src/mastra/public/workspace`, specify it explicitly:

```bash
LOCAL_WORKSPACE_PATH=/absolute/path/to/workspace npm run defradb:migrate
LOCAL_WORKSPACE_PATH=/absolute/path/to/workspace npm run defradb:verify
```

## 13. Verify Mac-to-VM synchronization

On the Mac, count visible entries:

```bash
defradb client query --url 127.0.0.1:9181 '
query {
  WorkspaceEntry(filter: { deleted: { _eq: false } }) {
    path
    entryType
    size
    contentHash
    writerNodeId
  }
}'
```

Run the identical query on the VM:

```bash
defradb client query --url 127.0.0.1:9181 '
query {
  WorkspaceEntry(filter: { deleted: { _eq: false } }) {
    path
    entryType
    size
    contentHash
    writerNodeId
  }
}'
```

Confirm that known files such as `/mac-test.md` and `/pigeonhole-principle.md` appear on the VM with the same sizes and hashes.

If nothing arrives:

1. Check TCP 9171 in both directions.
2. Check the `--peers` multiaddresses and peer IDs.
3. Re-run the active replicator commands.
4. Confirm both schemas are identical.
5. Inspect both DefraDB logs for connection or schema errors.

## 14. Cut the Mac agent over to DefraDB

On the Mac, change `.env`:

```dotenv
WORKSPACE_BACKEND=defradb
DEFRA_DB_NODE_ID=macbook
```

Start Mastra:

```bash
cd <PROJECT_DIR>
npm run dev
```

Run a simple agent operation that reads a known workspace file. Then initiate an A2A exchange that creates a transcript.

Query the Mac DefraDB node and confirm the new transcript path appears:

```bash
defradb client query --url 127.0.0.1:9181 '
query {
  WorkspaceEntry(filter: { path: { _like: "/a2a%" }, deleted: { _eq: false } }) {
    path
    modifiedAt
    writerNodeId
  }
}'
```

If `_like` is unavailable in the pinned release, query all `WorkspaceEntry` documents and inspect the `/a2a/` paths.

Confirm no new transcript file was written under the old local workspace.

## 15. Cut the VM agent over to DefraDB

On the VM, change `.env`:

```dotenv
WORKSPACE_BACKEND=defradb
DEFRA_DB_NODE_ID=vm
```

Restart the VM Mastra agent using its existing service or development command.

Have the VM agent create or update a workspace file. Query the VM node and then the Mac node to confirm the same path, content hash, revision, and `writerNodeId: "vm"` appear on both.

This reverse-direction test is required. Mac-to-VM success alone does not prove that the VM can replicate changes back to the Mac.

## 16. Test offline synchronization

1. Stop the VM DefraDB node.
2. Create a workspace transcript or file through the Mac agent.
3. Confirm the Mac operation succeeds locally.
4. Restart the VM node with its `--peers` argument.
5. Reapply the Mac-to-VM and VM-to-Mac replicators if required by the pinned version.
6. Confirm the offline change eventually appears on the VM.
7. Repeat with the Mac node offline and a VM-originated change.

Do not declare the rollout complete until both directions recover from an offline interval.

## 17. Configure automatic startup on the VM

After foreground testing succeeds, create `/etc/systemd/system/defradb-a2a.service` on the VM:

```ini
[Unit]
Description=DefraDB A2A workspace node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=<VM_USER>
ExecStart=/usr/local/bin/defradb start --rootdir /home/<VM_USER>/.defradb-a2a --url 127.0.0.1:9181 --p2paddr /ip4/0.0.0.0/tcp/9171 --peers /ip4/<MAC_IP>/tcp/9171/p2p/<MAC_PEER_ID>
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now defradb-a2a
sudo systemctl status defradb-a2a
journalctl -u defradb-a2a -f
```

If replicators do not persist, add an idempotent post-start helper that waits for port 9181 and executes the VM-to-Mac `replicator set` command. Keep peer-info files readable only by the service user.

## 18. Configure automatic startup on macOS

After foreground testing succeeds, create `~/Library/LaunchAgents/network.source.defradb-a2a.plist`. Replace every placeholder with an absolute value; launchd does not expand shell variables in `ProgramArguments`.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>network.source.defradb-a2a</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/defradb</string>
    <string>start</string>
    <string>--rootdir</string>
    <string>/Users/<MAC_USER>/.defradb-a2a</string>
    <string>--url</string>
    <string>127.0.0.1:9181</string>
    <string>--p2paddr</string>
    <string>/ip4/0.0.0.0/tcp/9171</string>
    <string>--peers</string>
    <string>/ip4/<VM_IP>/tcp/9171/p2p/<VM_PEER_ID></string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/<MAC_USER>/Library/Logs/defradb-a2a.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/<MAC_USER>/Library/Logs/defradb-a2a-error.log</string>
</dict>
</plist>
```

Validate and load it:

```bash
plutil -lint ~/Library/LaunchAgents/network.source.defradb-a2a.plist
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/network.source.defradb-a2a.plist
launchctl print "gui/$(id -u)/network.source.defradb-a2a"
tail -f ~/Library/Logs/defradb-a2a.log
```

If the Mac binary is installed somewhere other than `/usr/local/bin/defradb`, use the result of `command -v defradb` in `ProgramArguments`.

If replicators do not persist, use a separate launchd job or wrapper to reapply the Mac-to-VM replicator after the local API becomes ready.

## 19. Back up both DefraDB nodes

The DefraDB root contains database data and the node's persistent identity. Stop the local DefraDB node before taking a filesystem-level backup.

On the Mac:

```bash
launchctl bootout "gui/$(id -u)/network.source.defradb-a2a"
tar -czf "$HOME/defradb-a2a-mac-$(date +%Y%m%d-%H%M%S).tar.gz" "$HOME/.defradb-a2a"
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/network.source.defradb-a2a.plist
```

On the VM:

```bash
sudo systemctl stop defradb-a2a
tar -czf "$HOME/defradb-a2a-vm-$(date +%Y%m%d-%H%M%S).tar.gz" "$HOME/.defradb-a2a"
sudo systemctl start defradb-a2a
```

Protect the backups because they contain node identity material and workspace content.

## 20. Roll back to the local workspace

If either agent cannot reliably use DefraDB:

1. Stop the affected Mastra agent.
2. Change its `.env` back to:

   ```dotenv
   WORKSPACE_BACKEND=local
   ```

3. Restart Mastra.
4. Leave both DefraDB nodes and their data intact for diagnosis.
5. Do not delete the pre-migration workspace backup.

Rollback changes where Mastra reads and writes future files; it does not automatically export newer DefraDB-only changes back into the old local directory.

## Final acceptance checklist

- [ ] Mac and VM run the exact same pinned DefraDB version.
- [ ] Mac and VM have different persistent peer IDs.
- [ ] Port 9181 is reachable only on localhost on each machine.
- [ ] Port 9171 is reachable between the Mac and VM in both directions.
- [ ] `WorkspaceEntry` schema is identical on both nodes.
- [ ] Both nodes start with the other node in `--peers`.
- [ ] Active replication is configured Mac-to-VM and VM-to-Mac.
- [ ] Existing Mac workspace migration passes hash verification.
- [ ] `/mac-test.md` and `/pigeonhole-principle.md` appear on the VM.
- [ ] A Mac-created A2A transcript appears on the VM.
- [ ] A VM-created workspace change appears on the Mac.
- [ ] Both directions catch up after an offline interval.
- [ ] Both Mastra agents use `WORKSPACE_BACKEND=defradb`.
- [ ] DefraDB and replicators recover after machine restart.
- [ ] Backups exist for the original workspace and both DefraDB roots.
