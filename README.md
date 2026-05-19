# Browser Controls

A Chrome extension that exposes browser automation commands via WebSocket, enabling AI agents to control a Chrome browser session programmatically.

## Commands

| Command | Description | Parameters |
|---------|-------------|------------|
| `navigate` | Navigate to a URL | `url` (string, required), `tabId` (number or 'active', optional) |
| `inspect` | Get element info at coordinates | `selector` (string), `tabId` (optional) |
| `inspect:start` | Start DOM inspection mode | `tabId` (optional) |
| `inspect:stop` | Stop DOM inspection mode | `tabId` (optional) |
| `query DOM` | Query DOM elements using CSS selector or XPath | `selector` (string, required), `tabId` (optional) |
| `click` | Click an element | `selector` (string, required), `tabId` (optional) |
| `type` | Type text into an element | `selector` (string, required), `text` (string, required), `tabId` (optional) |
| `scroll` | Scroll an element into view | `x` (number, optional), `y` (number, optional), `selector` (string, optional), `tabId` (optional) |
| `screenshot` | Capture visible tab screenshot | Returns data URL |
| `network:deep:start` | Start deep network monitoring | `tabId` (optional) |
| `network:getResponseBody` | Get response body for a request | `requestId` (string, required), `tabId` (optional) |
| `network:deep:stop` | Stop deep network monitoring | `tabId` (optional) |

## Events

The extension emits the following events via WebSocket:

- `tab:updated` - Tab content was updated
- `tab:activated` - Tab was activated/focused
- `inspect:hover` - Element hovered during inspection
- `inspect:select` - Element selected during inspection
- `network:request` - Network request initiated
- `network:response` - Network response received
- `network:complete` - Network request completed
- `network:error` - Network request error
- `cdp:Network.*` - Deep mode CDP network events

## Protocol

Communication uses JSON messages over WebSocket.

### Message Format

**Request:**
```json
{
  "id": "unique-request-id",
  "type": "request",
  "method": "command-name",
  "params": { /* command parameters */ },
  "tabId": 123  // optional: target specific tab
}
```

**Response:**
```json
{
  "id": "unique-request-id",
  "type": "response",
  "result": { /* response data */ }
}
```

**Error:**
```json
{
  "id": "unique-request-id",
  "type": "response",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Handshake

1. Agent sends `hello` message with version and permissions:
```json
{
  "type": "hello",
  "version": "1.0",
  "permissions": ["tabs", "network", "inspect"]
}
```

2. Extension responds with `hello_ack` containing session ID:
```json
{
  "type": "hello_ack",
  "sessionId": "unique-session-id",
  "version": "1.0"
}
```

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build for production
npm run build
```

### Loading the Extension

1. Run `npm run build`
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist` directory
5. Click the extension icon in Chrome to activate the popup
6. The extension will start a WebSocket server on the configured port

## Architecture

- **Background Script**: WebSocket server, command routing, network inspection
- **Content Script**: DOM manipulation, element inspection, user interactions
- **Popup**: UI for connection status and quick actions

## MCP Server

Bridge between AI agents (via MCP stdio) and the Chrome extension (via WebSocket).

### Setup

```bash
cd server && npm install
npm run build
```

### Running Modes

The MCP server supports two modes:

#### Standalone Mode (default)

Starts both WS server and MCP server in one process:

```bash
node server/dist/index.js
```

Extension connects directly. Simple but MCP process death kills WS connection.

#### Daemon + Controller Mode (recommended)

Run WS server as persistent daemon, MCP connects as controller client:

```bash
# Terminal 1: Start daemon (persistent)
node server/dist/index.js --daemon

# Terminal 2: MCP server auto-detects daemon and connects as controller
node server/dist/index.js
```

Benefits:
- Extension stays connected when MCP restarts
- Multiple MCP clients can connect simultaneously
- Daemon survives MCP process crashes

Auto-detect: MCP server tries to connect to daemon first. If no daemon found, falls back to standalone mode.

### Usage with Claude Desktop / pi

Add to MCP config:

```json
{
  "mcpServers": {
    "browser-controls": {
      "command": "node",
      "args": ["/path/to/browser-controls/server/dist/index.js"],
      "env": {
        "BROWSER_CONTROLS_PORT": "8765"
      }
    }
  }
}
```

For reliable operation, start daemon first: `node server/dist/index.js --daemon`

### CLI Options

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--port` | `BROWSER_CONTROLS_PORT` | 8765 | WebSocket port |
| `--token` | `BROWSER_CONTROLS_TOKEN` | — | Auth token |
| `--daemon` | — | — | Run WS server only (no MCP) |

### Available Tools

| Tool | Description |
|------|-------------|
| `navigate` | Navigate tab to URL |
| `inspect` | Get element info by selector |
| `inspect_start` | Start DOM picker mode |
| `inspect_stop` | Stop DOM picker mode |
| `query_dom` | Query elements by selector |
| `click` | Click element |
| `type` | Type text into element |
| `scroll` | Scroll page or element |
| `screenshot` | Capture visible tab (PNG) |
| `network_deep_start` | Start CDP network capture |
| `network_deep_stop` | Stop CDP network capture |
| `network_get_response_body` | Get captured response body |
