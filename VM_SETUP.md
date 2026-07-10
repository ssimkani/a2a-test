# VM A2A Server Setup

This branch is configured to expose `vm-agent` over Mastra's A2A HTTP endpoints. The server binds to all VM interfaces on port `4111` and streams A2A events with Server-Sent Events (SSE).

## 1. Clone and install

```bash
git clone <repository-url> a2a-test
cd a2a-test
git switch vm
npm ci
cp .env.example .env
```

Use Node.js 22.13 or newer.

## 2. Install and start Ollama

Install Ollama using the instructions for the VM operating system, then run:

```bash
ollama pull qwen3:1.7b
ollama serve
```

The default configuration expects Ollama at `http://127.0.0.1:11434/api`. Change `OLLAMA_BASE_URL` in `.env` if Ollama runs elsewhere.

## 3. Configure access

Set a long random `A2A_API_TOKEN` in `.env` if the bridged network is not fully trusted. Use the same value as `VM_A2A_TOKEN` on the client computer.

Set `MASTRA_STUDIO_HOST` to the VM's current bridged IP address. Keep `MASTRA_HOST=0.0.0.0`; that is the server bind address, while `MASTRA_STUDIO_HOST` is the address browsers use.

Allow inbound TCP port `4111` in the VM operating system firewall. Do not expose Ollama's port `11434`; only Mastra needs to reach it locally.

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

Keep the process alive with the VM's service manager for long-running use.

## 5. Verify from the client computer

Find the VM's bridged-network IP address, then check discovery:

```bash
curl -H "Authorization: Bearer $VM_A2A_TOKEN" \
  http://VM_IP:4111/api/.well-known/vm-agent/agent-card.json
```

If `A2A_API_TOKEN` is blank on the VM, omit the header.

On the client branch, stream a request with:

```bash
VM_MASTRA_BASE_URL=http://VM_IP:4111 \
VM_A2A_AGENT_ID=vm-agent \
VM_A2A_TOKEN=the-same-token \
npm run a2a:vm:stream -- "Reply with a streamed hello"
```

The execution endpoint used by the SDK is `http://VM_IP:4111/api/a2a/vm-agent`.

## 6. Send a streamed message from the VM to the MacBook

The MacBook must be running its Mastra server on its LAN interface. On the MacBook,
start it with:

```bash
HOST=0.0.0.0 npm run dev
```

From this VM project, configure `.env`:

```bash
MAC_MASTRA_BASE_URL=http://192.168.21.97:4111
MAC_A2A_AGENT_ID=a2a-agent
MAC_MASTRA_API_PREFIX=/api
```

If the MacBook uses an A2A bearer token, set the same value in `MAC_A2A_TOKEN`.
Then run:

```bash
npm run a2a:mac:stream -- "Hello from the VM agent"
```

The MacBook firewall must allow inbound TCP port `4111`, and the MacBook Mastra
server must expose an agent with ID `a2a-agent`.
