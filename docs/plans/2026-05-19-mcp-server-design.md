# MCP Server for Browser Controls

## Goal

MCP server that exposes browser automation commands to AI agents. Runs WebSocket server that Chrome extension connects to, bridges MCP tool calls to extension commands.

## Architecture

```
┌─────────────────┐     stdio      ┌─────────────────┐
│   AI Agent      │◄──────────────►│   MCP Server    │
│ (Claude, etc.)  │                │  server/index.ts│
└─────────────────┘                └────────┬────────┘
                                            │
                                   WebSocket│:8765
                                            │
                                   ┌────────▼────────┐
                                   │ Chrome Extension│
                                   │   (client)      │
                                   └─────────────────┘
```

**Components:**

- `server/` — new directory in monorepo
- MCP stdio transport — AI agents connect via stdin/stdout
- WebSocket server — listens on configurable port (default 8765), accepts extension connection
- Shared types — import from `extension/src/shared/protocol.ts`

**Flow:**

1. Start MCP server: `npx browser-controls-server` or via Claude Desktop config
2. Server starts WebSocket on `:8765`
3. User loads extension, it connects to server
4. AI agent calls MCP tools → server sends commands to extension → returns results

## MCP Tools

12 tools mapping 1:1 to extension commands:

| Tool | Description | Parameters |
|------|-------------|------------|
| `navigate` | Navigate tab to URL | `url` (required), `tabId?` |
| `inspect` | Get element info | `selector`, `tabId?` |
| `inspect_start` | Start DOM picker mode | `tabId?` |
| `inspect_stop` | Stop DOM picker mode | `tabId?` |
| `query_dom` | Query elements by selector | `selector` (required), `tabId?` |
| `click` | Click element | `selector` (required), `tabId?` |
| `type` | Type into element | `selector`, `text` (required), `tabId?` |
| `scroll` | Scroll page/element | `x?`, `y?`, `selector?`, `tabId?` |
| `screenshot` | Capture visible tab | `tabId?` — returns base64 data URL |
| `network_deep_start` | Start CDP network capture | `tabId?` |
| `network_deep_stop` | Stop CDP network capture | `tabId?` |
| `network_get_response_body` | Get response body | `requestId` (required), `tabId?` |

Tool names use underscores (MCP convention) vs colons in protocol.

Error handling: If extension not connected, return error `{ code: "EXTENSION_NOT_CONNECTED", message: "Chrome extension not connected" }`.

## Server Implementation

**Files:**

```
server/
├── package.json          # separate package, depends on @modelcontextprotocol/sdk
├── tsconfig.json         # extends root, compiles to dist/
├── src/
│   ├── index.ts          # entry: parse args, start server
│   ├── mcp.ts            # MCP server setup, tool definitions
│   ├── wsServer.ts       # WebSocket server, extension connection
│   └── bridge.ts         # routes MCP tool calls → WS commands
```

**Key logic:**

- `wsServer.ts` — accepts single extension connection, tracks connected state, handles hello/hello_ack handshake
- `bridge.ts` — maps tool name → protocol method, generates request IDs, awaits responses with timeout (30s default)
- `mcp.ts` — registers 12 tools with Zod schemas, calls bridge, formats responses

**Config:**

```bash
# Environment
BROWSER_CONTROLS_PORT=8765
BROWSER_CONTROLS_TOKEN=optional-secret

# CLI overrides
npx browser-controls-server --port 9000 --token mysecret
```

**Entry in root package.json:**

```json
{
  "bin": {
    "browser-controls-server": "./server/dist/index.js"
  }
}
```

## Connection & Error Handling

**Extension connection lifecycle:**

1. Server starts WebSocket on configured port
2. Extension connects, sends `hello`
3. Server responds `hello_ack` with sessionId
4. Server marks `connected = true`
5. On disconnect, marks `connected = false`, logs warning

**Tool call flow:**

```typescript
async function callExtension(method: string, params: object): Promise<unknown> {
  if (!connected) {
    throw new McpError("EXTENSION_NOT_CONNECTED", "Chrome extension not connected");
  }
  
  const id = crypto.randomUUID();
  const request = { id, type: "request", method, params };
  
  ws.send(JSON.stringify(request));
  
  // Wait for response with matching id (30s timeout)
  const response = await waitForResponse(id, 30000);
  
  if (response.error) {
    throw new McpError(response.error.code, response.error.message);
  }
  
  return response.result;
}
```

**Timeout:** If extension doesn't respond in 30s, return error `COMMAND_TIMEOUT`.

**Single connection:** Only one extension connection allowed. New connection replaces old (logs warning).

## Testing Strategy

**Unit tests:**

- `wsServer.test.ts` — connection handling, hello handshake, disconnect
- `bridge.test.ts` — request/response correlation, timeout, error mapping
- `mcp.test.ts` — tool schemas validate correctly, parameter mapping

**Integration test:**

- Mock WebSocket client simulating extension
- Call MCP tools via stdio, verify correct protocol messages sent
- Test error cases: not connected, timeout, extension error

**Manual testing:**

- Start server, load real extension, call tools via Claude Desktop

## Decisions

- **Monorepo** — server in same repo as extension, shared types
- **stdio transport** — standard MCP transport for Claude Desktop, Cursor
- **1:1 tool mapping** — clearer tool descriptions for AI discovery
- **Fail fast** — return error immediately if extension not connected
- **Base64 screenshots** — inline in response, no temp files
- **No events v1** — MCP is request/response, skip event streaming initially
- **CLI + env config** — env vars as defaults, CLI overrides
