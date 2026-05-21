# Browser Controls

Chrome extension + MCP server that lets AI agents control a browser via WebSocket.

---

## Quick Start

### 1. Install Extension

```bash
# Clone & build
git clone <repo-url> && cd browser-controls
npm install
npm run build
```

Load in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `dist/` folder
4. Click extension icon to open popup — shows connection status

### 2. Run Daemon

```bash
# Build server
cd server && npm install && npm run build && cd ..

# Start daemon (keeps WS alive across MCP restarts)
node server/dist/index.js --daemon
```

Extension auto-connects to `ws://localhost:8765`.

### 3. Add MCP to Cursor

In Cursor settings, add to your MCP config (`.cursor/mcp.json` or global):

```json
{
  "mcpServers": {
    "browser-controls": {
      "command": "node",
      "args": ["/absolute/path/to/browser-controls/server/dist/index.js"]
    }
  }
}
```

MCP server auto-detects running daemon. If no daemon, runs standalone.

Optional env vars:

```json
{
  "mcpServers": {
    "browser-controls": {
      "command": "node",
      "args": ["/absolute/path/to/browser-controls/server/dist/index.js"],
      "env": {
        "BROWSER_CONTROLS_PORT": "8765",
        "BROWSER_CONTROLS_TOKEN": "your-secret-token"
      }
    }
  }
}
```

---

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `navigate` | Navigate tab to URL |
| `inspect` | Get element info by selector |
| `inspect_start` | Start DOM picker mode |
| `inspect_stop` | Stop DOM picker mode |
| `query_dom` | Query elements by CSS/XPath |
| `click` | Click element |
| `type` | Type text into element |
| `scroll` | Scroll page or element |
| `screenshot` | Capture visible tab (PNG) |
| `network_deep_start` | Start CDP network capture |
| `network_deep_stop` | Stop CDP network capture |
| `network_get_response_body` | Get captured response body |

---

## CLI Reference

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--port` | `BROWSER_CONTROLS_PORT` | `8765` | WebSocket port |
| `--token` | `BROWSER_CONTROLS_TOKEN` | — | Auth token (optional) |
| `--daemon` | — | — | Run WS server only (no MCP) |

---

## Architecture

```
┌─────────────┐   WebSocket   ┌──────────────┐   stdio   ┌────────┐
│  Chrome Ext  │◄────────────►│  Daemon/MCP   │◄─────────►│ Cursor │
└─────────────┘               └──────────────┘            └────────┘
```

- **Extension** (`dist/`): Background script runs WS client, content script handles DOM
- **Daemon** (`server/`): Persistent WS server, survives MCP restarts
- **MCP Server** (`server/`): Bridges MCP stdio ↔ WS commands

### Daemon vs Standalone

| Mode | Command | Use case |
|------|---------|----------|
| Daemon | `node server/dist/index.js --daemon` | Production — extension stays connected |
| Standalone | `node server/dist/index.js` | Quick test — all-in-one process |

---

## Development

```bash
npm install          # Extension deps
npm test             # Run tests
npm run typecheck    # Type check
npm run build        # Build extension → dist/

cd server
npm install          # Server deps
npm run build        # Build server → server/dist/
```

---

## Protocol

JSON messages over WebSocket. See [full protocol docs](docs/) for request/response format, handshake, and events.

### Events Emitted

- `tab:updated` / `tab:activated` — Tab changes
- `inspect:hover` / `inspect:select` — DOM inspection
- `network:request` / `network:response` / `network:complete` / `network:error` — Network
- `cdp:Network.*` — Deep mode CDP events
