# Configure DefraDB on the Mac and Windows computer

This runbook configures one local DefraDB node on the MacBook and one on the Windows computer, connects them over DefraDB's P2P network, replicates the `WorkspaceEntry` collection in both directions, migrates the existing Mac workspace, and switches both Mastra agents to DefraDB-backed workspaces.

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
| `<MAC_IP>` | Mac IP reachable from the Windows computer | `192.168.137.3` |
| `<WINDOWS_IP>` | Windows IP reachable from the Mac | `192.168.21.175` |
| `<MAC_PEER_ID>` | Peer ID printed by the Mac DefraDB node | `12D3Koo...` |
| `<WINDOWS_PEER_ID>` | Peer ID printed by the Windows computer DefraDB node | `12D3Koo...` |
| `<MAC_PROJECT_DIR>` | Absolute project directory on the Mac | `/Users/seena/repos/a2a-test` |
| `<WINDOWS_PROJECT_DIR>` | Absolute project directory on Windows | `C:\Users\<WINDOWS_USER>\repos\a2a-test` |

The supplied Windows address was `1982.168.21.175`, which is not valid IPv4 because an octet cannot exceed 255. This guide assumes the intended address is `192.168.21.175`. Confirm it with `ipconfig` before continuing and replace `<WINDOWS_IP>` if it differs.

The ports in this guide are:

- `9181/tcp`: local DefraDB HTTP and GraphQL API; keep bound to `127.0.0.1`.
- `9171/tcp`: DefraDB P2P traffic; expose only between the Mac and Windows.
- `4111/tcp`: the existing Mastra/A2A server.

## 1. Confirm the Mac and Windows can reach each other

On the Mac, find the current address. `en0` is normally Wi-Fi, but use the interface connected to the Windows computer network:

```bash
ipconfig getifaddr en0
```

In PowerShell on the Windows computer, find its IPv4 address:

```powershell
Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object IPAddress -NotLike '169.254.*' |
  Format-Table InterfaceAlias,IPAddress
```

Confirm basic connectivity from the Mac:

```bash
ping -c 3 192.168.21.175
```

Confirm basic connectivity from the Windows computer:

```powershell
Test-Connection 192.168.137.3 -Count 3
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

Check the Windows architecture in PowerShell:

```powershell
$env:PROCESSOR_ARCHITECTURE
```

Typical results are `AMD64` or `ARM64`. Download the matching Windows archive from the pinned release. If that release has no native Windows artifact, run the Windows node under WSL 2 and use the WSL-facing IP consistently instead of the host IP.

After extracting the downloaded archive, install the binary on the Mac:

```bash
sudo install -m 0755 /path/to/extracted/defradb /usr/local/bin/defradb
defradb version
```

Extract the Windows archive, place `defradb.exe` in a stable directory such as `C:\Program Files\DefraDB`, add that directory to the user or system `PATH`, and verify it in a new PowerShell window:

```powershell
defradb version
```

Stop here unless both commands report the exact same version:

```text
Mac version = Windows version = <DEFRA_VERSION>
```

Do not copy an existing `~/.defradb` data directory between different DefraDB versions.

## 3. Deploy the current project code to both machines

The Windows computer must contain the same implementation as the Mac, including:

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

Deploy the same Git commit to the Windows computer using the project's existing deployment method. Then install Node dependencies on both systems:

```bash
cd <MAC_PROJECT_DIR>
npm install
```

On Windows, use PowerShell:

```powershell
Set-Location <WINDOWS_PROJECT_DIR>
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

Retain the existing Mac-to-Windows A2A settings:

```dotenv
WINDOWS_MASTRA_BASE_URL=http://192.168.21.175:4111
WINDOWS_A2A_AGENT_ID=windows-agent
WINDOWS_MASTRA_API_PREFIX=/api
WINDOWS_A2A_TOKEN=<the-Windows-token-if-enabled>
```

## 5. Configure the Windows computer environment

In the Windows computer project directory, add the following to `.env`:

```dotenv
WORKSPACE_BACKEND=local
DEFRA_DB_URL=http://127.0.0.1:9181
DEFRA_DB_GRAPHQL_PATH=/api/v0/graphql
DEFRA_DB_NODE_ID=windows
DEFRA_DB_REQUEST_TIMEOUT_MS=10000
DEFRA_DB_MAX_FILE_BYTES=10485760
```

Use `DEFRA_DB_NODE_ID=windows`, not `macbook`. The writer node ID is stored with workspace changes for diagnostics. Configure the Windows Mastra server with `MASTRA_HOST=0.0.0.0` so the Mac can reach port 4111, and restrict that port to the Mac's address in Windows Defender Firewall.

Retain the Windows computer's existing A2A settings for reaching the Mac agent.

## 6. Start a new DefraDB node on the Mac

For initial setup, run DefraDB in a dedicated foreground terminal so its logs remain visible:

```powershell
defradb start `
  --rootdir "$HOME\.defradb-a2a" `
  --url 127.0.0.1:9181 `
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

## 7. Start a new DefraDB node on the Windows computer

On the Windows computer, run:

```bash
defradb start \
  --rootdir ~/.defradb-a2a \
  --url 127.0.0.1:9181 \
  --p2paddr /ip4/0.0.0.0/tcp/9171
```

In another PowerShell terminal, verify it and save its peer information:

```powershell
defradb client p2p info --url 127.0.0.1:9181
defradb client p2p info --url 127.0.0.1:9181 | Set-Content -Encoding utf8 windows-peer-info.json
```

Record the peer ID as `<WINDOWS_PEER_ID>`.

The Mac and Windows must have different peer IDs. If they are identical, the same DefraDB root directory or peer key was copied to both machines. Stop both nodes and create a fresh root directory for one of them.

## 8. Restrict the P2P firewall rules

Do not expose port 9181 to the LAN or internet. The Mastra process connects to DefraDB through localhost on each machine.

In an elevated PowerShell window, allow DefraDB P2P traffic only from the Mac. Add a separate port 4111 rule if the Windows Mastra agent must accept A2A calls:

```powershell
New-NetFirewallRule -DisplayName 'DefraDB P2P from Mac' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 9171 `
  -RemoteAddress 192.168.137.3
New-NetFirewallRule -DisplayName 'Mastra A2A from Mac' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4111 `
  -RemoteAddress 192.168.137.3
```

Configure the Mac firewall or network firewall to permit inbound TCP 9171 from `<WINDOWS_IP>` only.

With both nodes running, test from the Mac:

```bash
nc -vz <WINDOWS_IP> 9171
```

Test from the Windows computer:

```powershell
Test-NetConnection 192.168.137.3 -Port 9171
```

Both checks must succeed before configuring replication.

## 9. Install the workspace schema on both nodes

On the Mac:

```bash
cd <MAC_PROJECT_DIR>
npm run defradb:bootstrap
```

On the Windows computer:

```powershell
Set-Location <WINDOWS_PROJECT_DIR>
npm run defradb:bootstrap
```

Confirm the collection exists on both nodes:

```bash
defradb client schema describe --url 127.0.0.1:9181 --name WorkspaceEntry
```

The schema definitions must match. Do not begin replication with different `WorkspaceEntry` schemas.

## 10. Restart both nodes as explicit peers

Stop the foreground DefraDB process on each machine with `Ctrl-C`.

Restart the Mac and tell it how to reach the Windows computer:

```bash
defradb start \
  --rootdir ~/.defradb-a2a \
  --url 127.0.0.1:9181 \
  --p2paddr /ip4/0.0.0.0/tcp/9171 \
  --peers /ip4/<WINDOWS_IP>/tcp/9171/p2p/<WINDOWS_PEER_ID>
```

Restart the Windows computer and tell it how to reach the Mac:

```powershell
defradb start `
  --rootdir "$HOME\.defradb-a2a" `
  --url 127.0.0.1:9181 `
  --p2paddr /ip4/0.0.0.0/tcp/9171 `
  --peers /ip4/<MAC_IP>/tcp/9171/p2p/<MAC_PEER_ID>
```

Check both logs for a successful peer connection. Re-run `p2p info` to ensure the persistent peer IDs did not change.

## 11. Configure active replication in both directions

Active replication explicitly pushes the entire `WorkspaceEntry` collection to the other node.

Copy `windows-peer-info.json` from the Windows computer to a temporary safe location on the Mac. On the Mac, run:

```bash
defradb client p2p replicator set \
  --url 127.0.0.1:9181 \
  -c WorkspaceEntry \
  "$(cat windows-peer-info.json)"
```

Copy `mac-peer-info.json` from the Mac to a temporary safe location on the Windows computer. On the Windows computer, run:

```powershell
defradb client p2p replicator set `
  --url 127.0.0.1:9181 `
  -c WorkspaceEntry `
  (Get-Content -Raw mac-peer-info.json)
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
cd <MAC_PROJECT_DIR>
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

## 13. Verify Mac-to-Windows synchronization

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

Run the identical query on the Windows computer:

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

Confirm that known files such as `/mac-test.md` and `/pigeonhole-principle.md` appear on the Windows computer with the same sizes and hashes.

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
cd <MAC_PROJECT_DIR>
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

## 15. Cut the Windows computer agent over to DefraDB

On the Windows computer, change `.env`:

```dotenv
WORKSPACE_BACKEND=defradb
DEFRA_DB_NODE_ID=windows
```

Restart the Windows computer Mastra agent using its existing service or development command.

Have the Windows computer agent create or update a workspace file. Query the Windows computer node and then the Mac node to confirm the same path, content hash, revision, and `writerNodeId: "windows"` appear on both.

This reverse-direction test is required. Mac-to-Windows success alone does not prove that the Windows computer can replicate changes back to the Mac.

## 16. Test offline synchronization

1. Stop the Windows computer DefraDB node.
2. Create a workspace transcript or file through the Mac agent.
3. Confirm the Mac operation succeeds locally.
4. Restart the Windows computer node with its `--peers` argument.
5. Reapply the Mac-to-Windows and Windows-to-Mac replicators if required by the pinned version.
6. Confirm the offline change eventually appears on the Windows computer.
7. Repeat with the Mac node offline and a Windows-originated change.

Do not declare the rollout complete until both directions recover from an offline interval.

## 17. Configure automatic startup on Windows

After foreground testing succeeds, create `C:\ProgramData\DefraDB\start-defradb.ps1` in an elevated PowerShell window. Replace the peer ID first:

```powershell
$script = @'
& 'C:\Program Files\DefraDB\defradb.exe' start `
  --rootdir "$env:USERPROFILE\.defradb-a2a" `
  --url 127.0.0.1:9181 `
  --p2paddr /ip4/0.0.0.0/tcp/9171 `
  --peers /ip4/192.168.137.3/tcp/9171/p2p/<MAC_PEER_ID>
'@
New-Item -ItemType Directory -Force C:\ProgramData\DefraDB | Out-Null
Set-Content -Path C:\ProgramData\DefraDB\start-defradb.ps1 -Value $script -Encoding utf8
```

Register and start a scheduled task under the Windows account that owns the DefraDB root and peer identity:

```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File "C:\ProgramData\DefraDB\start-defradb.ps1"'
$trigger = New-ScheduledTaskTrigger -AtLogOn -User '<WINDOWS_USER>'
Register-ScheduledTask -TaskName 'DefraDB A2A' -Action $action -Trigger $trigger `
  -Description 'DefraDB A2A workspace node' -RunLevel Highest
Start-ScheduledTask -TaskName 'DefraDB A2A'
Get-ScheduledTask -TaskName 'DefraDB A2A'
```

If replicators do not persist, extend the startup script with an idempotent readiness check and the Windows-to-Mac `replicator set` command. Keep peer-info files readable only by the task's Windows user.

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
    <string>/ip4/<WINDOWS_IP>/tcp/9171/p2p/<WINDOWS_PEER_ID></string>
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

If replicators do not persist, use a separate launchd job or wrapper to reapply the Mac-to-Windows replicator after the local API becomes ready.

## 19. Back up both DefraDB nodes

The DefraDB root contains database data and the node's persistent identity. Stop the local DefraDB node before taking a filesystem-level backup.

On the Mac:

```bash
launchctl bootout "gui/$(id -u)/network.source.defradb-a2a"
tar -czf "$HOME/defradb-a2a-mac-$(date +%Y%m%d-%H%M%S).tar.gz" "$HOME/.defradb-a2a"
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/network.source.defradb-a2a.plist
```

On Windows, stop the scheduled task, back up the root, and restart it:

```powershell
Stop-ScheduledTask -TaskName 'DefraDB A2A'
$stamp = Get-Date -Format yyyyMMdd-HHmmss
Compress-Archive -Path "$HOME\.defradb-a2a" `
  -DestinationPath "$HOME\defradb-a2a-windows-$stamp.zip"
Start-ScheduledTask -TaskName 'DefraDB A2A'
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

- [ ] Mac and Windows run the exact same pinned DefraDB version.
- [ ] Mac and Windows have different persistent peer IDs.
- [ ] Port 9181 is reachable only on localhost on each machine.
- [ ] Port 9171 is reachable between the Mac and Windows in both directions.
- [ ] `WorkspaceEntry` schema is identical on both nodes.
- [ ] Both nodes start with the other node in `--peers`.
- [ ] Active replication is configured Mac-to-Windows and Windows-to-Mac.
- [ ] Existing Mac workspace migration passes hash verification.
- [ ] `/mac-test.md` and `/pigeonhole-principle.md` appear on the Windows computer.
- [ ] A Mac-created A2A transcript appears on the Windows computer.
- [ ] A Windows-created workspace change appears on the Mac.
- [ ] Both directions catch up after an offline interval.
- [ ] Both Mastra agents use `WORKSPACE_BACKEND=defradb`.
- [ ] DefraDB and replicators recover after machine restart.
- [ ] Backups exist for the original workspace and both DefraDB roots.
