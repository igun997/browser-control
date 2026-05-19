# Daemon Architecture Design

## Problem

MCP server spawned by pi as child process also runs the WS server. If WS port is busy or MCP process dies, extension loses connection and pi can't respawn mid-session.

## Solution

Separate WS server into persistent daemon. MCP server connects to daemon as a controller client instead of owning the WS server.

## Architecture

```
Chrome Extension ←─WS─→ Daemon (port 8765) ←─WS─→ MCP Controller(s)
                         (persistent)              (ephemeral)

pi (stdio) ←→ MCP Server ─── connects as WS controller ──→ Daemon
```

## Protocol

### Handshake — Extension (existing)
```
Extension → Daemon:  {type: "hello", version, permissions, tabs, token?}
Daemon → Extension:  {type: "hello_ack", sessionId}
```

### Handshake — Controller (new)
```
Controller → Daemon:  {type: "controller_hello", token?}
Daemon → Controller:  {type: "controller_hello_ack", sessionId, extensionConnected: bool}
```

### Request Routing

Controller sends request using existing protocol:
```json
{type: "request", id: "uuid", method: "navigate", params: {url: "..."}}
```

Daemon forwards to extension as-is. Extension responds:
```json
{type: "response", id: "uuid", result: {...}}
```

Daemon routes response back to the controller that sent the original request (tracked by request ID).

### Extension Events

When extension sends events, daemon broadcasts to all connected controllers.

### Extension Status Notifications

When extension connects/disconnects, daemon notifies all controllers:
```json
{type: "extension_status", connected: true/false}
```

## Multiple Controllers

- Multiple controllers can connect simultaneously
- Each controller's pending requests tracked by request ID in daemon
- Responses routed to correct controller
- New controller does NOT replace old

## Single Extension

- Only 1 extension connection (existing behavior)
- New extension replaces old

## Auto-detect Mode (MCP Entry Point)

`node server/dist/index.js` behavior:

1. Try connecting to `ws://localhost:{port}` as controller
2. If connection succeeds + `controller_hello_ack` received → run as MCP controller only
3. If connection fails (ECONNREFUSED) → start daemon in-process + run MCP (fallback to current behavior)

This means:
- **Daemon running** → MCP connects as controller, daemon stays persistent across MCP restarts
- **No daemon** → works exactly like before (WS server + MCP in same process)

## File Changes

### New Files
- `server/src/daemon.ts` — standalone daemon class (WS server + routing)

### Modified Files
- `server/src/wsServer.ts` — refactor ExtensionServer to support controller connections + routing
- `server/src/bridge.ts` — Bridge connects via WS client (controller mode) OR direct reference (fallback mode)
- `server/src/index.ts` — auto-detect logic: try controller first, fallback to in-process

### No Changes
- `server/src/mcp.ts` — MCP tool definitions unchanged, Bridge interface stays same
- Extension code — no changes, same hello handshake
