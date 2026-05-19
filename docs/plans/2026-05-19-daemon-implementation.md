# Daemon Architecture Implementation Plan

**Design:** `docs/plans/2026-05-19-daemon-architecture-design.md`

## Tasks

### Task 1: Refactor ExtensionServer to support controller role

**File:** `server/src/wsServer.ts`

Add controller connection handling to existing ExtensionServer:

- Add `controller_hello` handshake alongside existing `hello`
- Track controllers in `Map<string, WebSocket>` (sessionId → ws)
- Track which controller sent each request: `Map<requestId, controllerId>`
- Route extension responses back to correct controller
- Broadcast extension events to all controllers
- Send `extension_status` notification when extension connects/disconnects
- Controller disconnect cleans up its pending requests
- `send()` method still works for in-process usage (fallback mode)

**Tests:** Update `server/src/wsServer.test.ts`
- Controller connects with `controller_hello`, receives `controller_hello_ack`
- Controller request forwarded to extension
- Extension response routed back to correct controller
- Multiple controllers get correct responses
- Token auth works for controllers
- Controller disconnect cleans up
- `extension_status` broadcast on extension connect/disconnect

### Task 2: Create ControllerClient

**New file:** `server/src/controllerClient.ts`

WS client that connects to daemon as controller:

- Connects to `ws://localhost:{port}`
- Sends `controller_hello` with optional token
- Waits for `controller_hello_ack`
- Implements same interface as `ExtensionServer.send(method, params)` — so Bridge works with either
- Tracks pending requests with timeout
- Handles `extension_status` notifications
- Reconnect not needed (MCP process is ephemeral)
- `isConnected()` reflects extension status from daemon (not just WS connection)

**Interface:**
```typescript
interface CommandSender {
  send(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  isConnected(): boolean;
  close(): void;
}
```

Both `ExtensionServer` and `ControllerClient` implement `CommandSender`.

**Tests:** `server/src/controllerClient.test.ts`
- Connects and completes handshake
- `send()` sends request, resolves with response
- Timeout rejects pending requests
- `isConnected()` tracks extension status
- Token auth sent in handshake

### Task 3: Extract CommandSender interface, update Bridge

**Files:** `server/src/bridge.ts`, new `server/src/types.ts`

- Extract `CommandSender` interface to `types.ts`
- Make `ExtensionServer` implement `CommandSender`
- Make `ControllerClient` implement `CommandSender`
- Bridge constructor takes `CommandSender` instead of `ExtensionServer`
- No other changes to Bridge — `send()` interface is identical

**Tests:** Update `server/src/bridge.test.ts` to use `CommandSender` mock

### Task 4: Auto-detect entry point

**File:** `server/src/index.ts`

Update `main()`:

```
1. Parse args (port, token)
2. Try: connect ControllerClient to ws://localhost:{port}
3. If connected:
   - Log "[browser-controls] Connected to daemon on port {port}"
   - Create Bridge(controllerClient)
   - Create MCP server, connect stdio
4. If ECONNREFUSED:
   - Log "[browser-controls] No daemon found, starting in standalone mode"
   - Start ExtensionServer on port (existing behavior)
   - Create Bridge(extensionServer)
   - Create MCP server, connect stdio
5. Graceful shutdown closes whichever mode is active
```

**Tests:** Update `server/src/index.test.ts`

### Task 5: Add daemon CLI mode

**File:** `server/src/index.ts`

Add `--daemon` flag:
- `node server/dist/index.js --daemon` — starts WS server only, no MCP, stays running
- No stdio, just WS server listening
- Logs connections/disconnections
- Useful for running in tmux/systemd

Update `parseArgs` to handle `--daemon` flag.

**Tests:** Verify `--daemon` starts WS-only, no MCP

### Task 6: Integration test

**File:** `server/src/daemon-integration.test.ts`

Full round-trip test:
1. Start ExtensionServer (daemon)
2. Connect mock extension (hello handshake)
3. Connect ControllerClient
4. Send request through controller → daemon → mock extension → response back
5. Verify response arrives at controller
6. Test multiple controllers
7. Test extension disconnect notification

### Task 7: Update docs

- Update `server/README.md` with daemon usage
- Update pi MCP config example
- Document `--daemon` flag
