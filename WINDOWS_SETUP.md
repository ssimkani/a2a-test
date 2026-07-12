# Windows A2A Server Setup

This branch is configured to expose `windows-agent` over Mastra's A2A HTTP endpoints. The server binds to all Windows interfaces on port `4111` and streams A2A events with Server-Sent Events (SSE).

## 1. Clone and install

```powershell
git clone <repository-url> a2a-test
Set-Location a2a-test
git switch windows
npm ci
Copy-Item .env.example .env
```

Use Node.js 22.13 or newer.

## 2. Install and start Ollama

Install Ollama for Windows, then run these commands in PowerShell:

```powershell
ollama pull lfm2.5-thinking
ollama serve
```

The default configuration expects Ollama at `http://127.0.0.1:11434/api`. Change `OLLAMA_BASE_URL` in `.env` if Ollama runs elsewhere.

## 3. Configure access

Set a long random `A2A_API_TOKEN` in `.env` if the peer-to-peer network is not fully trusted. Use the same value as `WINDOWS_A2A_TOKEN` on the client computer.

Set `MASTRA_STUDIO_HOST` to the Windows computer's current local peer-to-peer IP address. Keep `MASTRA_HOST=0.0.0.0`; that is the server bind address, while `MASTRA_STUDIO_HOST` is the address browsers use.

Allow inbound TCP port `4111` only from the Mac. In an elevated PowerShell window, run:

```powershell
New-NetFirewallRule -DisplayName 'Mastra A2A from Mac' `
  -Direction Inbound -Action Allow -Protocol TCP -LocalPort 4111 `
  -RemoteAddress 192.168.137.3
```

Do not expose Ollama's port `11434`; only Mastra needs to reach it locally.

## 4. Start the server

For development:

```bash
npm run dev
```

For a production-style run:

```bash
npm run build
npm start
```

Keep the process alive with the Windows computer's Task Scheduler or a Windows service wrapper for long-running use.

## 5. Verify from the client computer

Find the Windows computer's local peer-to-peer IP address, then check discovery:

```bash
curl -H "Authorization: Bearer $WINDOWS_A2A_TOKEN" \
  http://192.168.21.175:4111/api/.well-known/windows-agent/agent-card.json
```

If `A2A_API_TOKEN` is blank on Windows, omit the header.

On the Mac's `main` branch, configure the `WINDOWS_*` values in `.env`, then stream a request with:

```bash
npm run a2a:windows:stream -- "Reply with a streamed hello"
```

The execution endpoint used by the SDK is `http://192.168.21.175:4111/api/a2a/windows-agent`.

## 6. Send a streamed message from the Windows computer to the MacBook

The MacBook must be running its Mastra server on its LAN interface. On the MacBook,
configure `MASTRA_HOST=0.0.0.0` in `.env`, then start it with:

```bash
npm run dev
```

From this Windows project, configure `.env`:

```bash
MAC_MASTRA_BASE_URL=http://192.168.137.3:4111
MAC_A2A_AGENT_ID=a2a-agent
MAC_MASTRA_API_PREFIX=/api
```

If the MacBook uses an A2A bearer token, set the same value in `MAC_A2A_TOKEN`.
Then run:

```bash
npm run a2a:mac:stream -- "Hello from the Windows computer agent"
```

The MacBook firewall must allow inbound TCP port `4111`, and the MacBook Mastra
server must expose an agent with ID `a2a-agent`.
