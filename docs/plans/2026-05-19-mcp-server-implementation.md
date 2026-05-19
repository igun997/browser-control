# MCP Server Implementation Plan

> **REQUIRED SUB-SKILL:** Use the executing-plans skill to implement this plan task-by-task.

**Goal:** Build WebSocket+MCP stdio server that bridges AI agent tool calls to Chrome extension commands.

**Architecture:** Server dir in monorepo with 4 modules: entry (CLI+startup), WS server (extension connection), bridge (request/response correlation), MCP (tool registration). Extension connects outbound to server's WS; agents connect via stdio MCP transport.

**Tech Stack:** `@modelcontextprotocol/server` (v2), `zod/v4`, `ws` (Node WebSocket), TypeScript, vitest.

---

### Task 1: Server package scaffolding

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Modify: `tsconfig.json` (add `server/src` to include)
- Modify: `vitest.config.ts` (add `server/src` to test paths)

**Step 1: Create server/package.json**

```json
{
  "name": "browser-controls-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "browser-controls-server": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@modelcontextprotocol/server": "^1.29.0",
    "ws": "^8.18.0",
    "zod": "^3.25.0"
  },
  "devDependencies": {
    "@types/ws": "^8.18.0"
  }
}
```

**Step 2: Create server/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "types": ["node"],
    "lib": ["ES2022", "ES2023"]
  },
  "include": ["src"]
}
```

**Step 3: Update root tsconfig.json to include server/src**

Add `"server/src"` to the `include` array. Also add `"server/tsconfig.json"` to exclude (it has its own config).

```json
{
  "include": ["extension/src", "server/src", "vitest.config.ts"],
  "exclude": ["extension/vite.config.ts", "server/tsconfig.json"]
}
```

**Step 4: Update vitest.config.ts to include server tests**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['extension/src/test/setup.ts'],
    include: ['extension/src/**/*.test.ts', 'server/src/**/*.test.ts']
  }
});
```

**Step 5: Install dependencies**

Run: `cd server && npm install`

**Step 6: Commit**

```bash
git add server/package.json server/tsconfig.json tsconfig.json vitest.config.ts
git commit -m "chore: scaffold server package"
```

---

### Task 2: WebSocket server — connection lifecycle

**Files:**
- Create: `server/src/wsServer.ts`
- Create: `server/src/wsServer.test.ts`

**Step 1: Write failing test for wsServer**

```typescript
// server/src/wsServer.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ExtensionServer } from './wsServer.js';
import WebSocket, { WebSocketServer } from 'ws';

describe('ExtensionServer', () => {
  let server: ExtensionServer;

  afterEach(() => {
    server?.close();
  });

  it('starts on configured port', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();
    expect(port).toBeGreaterThan(0);
  });

  it('accepts extension hello and sends hello_ack', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    // Send hello
    ws.send(JSON.stringify({
      type: 'hello',
      version: '1.0.0',
      permissions: ['tabs'],
      tabs: [{ id: 1, url: 'https://example.com', title: 'Example', active: true }],
    }));

    // Should receive hello_ack
    const ack = await new Promise<Record<string, unknown>>((resolve) => {
      ws.on('message', (data) => {
        resolve(JSON.parse(data.toString()));
      });
    });

    expect(ack.type).toBe('hello_ack');
    expect(typeof ack.sessionId).toBe('string');

    ws.close();
  });

  it('reports connected after hello', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    expect(server.isConnected()).toBe(false);

    const ws = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws.on('open', resolve));

    ws.send(JSON.stringify({
      type: 'hello',
      version: '1.0.0',
      permissions: [],
      tabs: [],
    }));

    // Wait for hello processing
    await new Promise((r) => setTimeout(r, 50));
    expect(server.isConnected()).toBe(true);

    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(server.isConnected()).toBe(false);
  });

  it('replaces old connection on new connect', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    const ws1 = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws1.on('open', resolve));
    ws1.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
    await new Promise((r) => setTimeout(r, 50));

    const ws1Closed = new Promise<void>((resolve) => ws1.on('close', resolve));

    const ws2 = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws2.on('open', resolve));
    ws2.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));

    await ws1Closed;
    expect(server.isConnected()).toBe(true);

    ws2.close();
  });

  it('validates token when configured', async () => {
    server = new ExtensionServer({ port: 0, token: 'secret123' });
    const port = await server.start();

    // Wrong token
    const ws1 = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws1.on('open', resolve));
    ws1.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [], token: 'wrong' }));
    const closed = new Promise<number>((resolve) => ws1.on('close', (code) => resolve(code)));
    const code = await closed;
    expect(code).toBe(4001);
    expect(server.isConnected()).toBe(false);

    // Correct token
    const ws2 = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => ws2.on('open', resolve));
    ws2.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [], token: 'secret123' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(server.isConnected()).toBe(true);

    ws2.close();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/wsServer.test.ts`
Expected: FAIL — module not found

**Step 3: Implement wsServer.ts**

```typescript
// server/src/wsServer.ts
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { HelloMessage } from '../../extension/src/shared/protocol.js';

export interface ExtensionServerOptions {
  port: number;
  token?: string;
}

type PendingResolve = (value: unknown) => void;
type PendingReject = (reason: Error) => void;

export class ExtensionServer {
  private wss: WebSocketServer | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private readonly port: number;
  private readonly token?: string;
  private readonly pending = new Map<string, { resolve: PendingResolve; reject: PendingReject; timer: ReturnType<typeof setTimeout> }>();

  constructor(options: ExtensionServerOptions) {
    this.port = options.port;
    if (options.token !== undefined) {
      this.token = options.token;
    }
  }

  /** Start WebSocket server. Returns actual port (useful when port=0). */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.wss = new WebSocketServer({ port: this.port });

      this.wss.on('listening', () => {
        const addr = this.wss!.address();
        const actualPort = typeof addr === 'object' ? addr.port : this.port;
        resolve(actualPort);
      });

      this.wss.on('error', reject);

      this.wss.on('connection', (ws) => {
        this.handleConnection(ws);
      });
    });
  }

  private handleConnection(ws: WebSocket): void {
    // Wait for hello before accepting
    const helloTimeout = setTimeout(() => {
      ws.close(4000, 'Hello timeout');
    }, 5000);

    ws.once('message', (data) => {
      clearTimeout(helloTimeout);
      try {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type !== 'hello') {
          ws.close(4000, 'Expected hello');
          return;
        }

        // Validate token if configured
        if (this.token !== undefined) {
          const hello = msg as unknown as HelloMessage;
          if (hello.token !== this.token) {
            ws.close(4001, 'Invalid token');
            return;
          }
        }

        // Replace existing connection
        if (this.ws) {
          this.ws.close(4002, 'Replaced by new connection');
          this.rejectAllPending('Connection replaced');
        }

        this.ws = ws;
        this.connected = true;

        // Send hello_ack
        ws.send(JSON.stringify({
          type: 'hello_ack',
          sessionId: randomUUID(),
        }));

        // Wire up message and close handlers
        ws.on('message', (raw) => {
          this.handleMessage(raw.toString());
        });

        ws.on('close', () => {
          if (this.ws === ws) {
            this.connected = false;
            this.ws = null;
            this.rejectAllPending('Extension disconnected');
          }
        });
      } catch {
        ws.close(4000, 'Invalid hello');
      }
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // Ignore unparseable
    }

    // Handle responses to pending requests
    if (msg.type === 'response' && typeof msg.id === 'string') {
      const entry = this.pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);

        if (msg.error) {
          const err = msg.error as { code: string; message: string };
          const error = new Error(err.message);
          (error as Error & { code: string }).code = err.code;
          entry.reject(error);
        } else {
          entry.resolve(msg.result);
        }
      }
    }
    // Events from extension are ignored for now (v1 — no MCP event streaming)
  }

  /** Send a command to extension and await response. */
  send(method: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    if (!this.connected || !this.ws) {
      return Promise.reject(new Error('Extension not connected'));
    }

    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Command timeout'));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      this.ws!.send(JSON.stringify({
        id,
        type: 'request',
        method,
        params,
      }));
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  close(): void {
    this.rejectAllPending('Server closing');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
    this.connected = false;
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run server/src/wsServer.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add server/src/wsServer.ts server/src/wsServer.test.ts
git commit -m "feat(server): add WebSocket server for extension connection"
```

---

### Task 3: Bridge — request/response correlation

**Files:**
- Create: `server/src/bridge.ts`
- Create: `server/src/bridge.test.ts`

**Step 1: Write failing tests**

```typescript
// server/src/bridge.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bridge, METHOD_MAP } from './bridge.js';
import type { ExtensionServer } from './wsServer.js';

function createMockServer() {
  return {
    isConnected: vi.fn(() => true),
    send: vi.fn(async () => ({ ok: true })),
  } as unknown as ExtensionServer;
}

describe('Bridge', () => {
  let bridge: Bridge;
  let mockServer: ReturnType<typeof createMockServer>;

  beforeEach(() => {
    mockServer = createMockServer();
    bridge = new Bridge(mockServer);
  });

  it('maps tool name to protocol method', async () => {
    await bridge.call('network_deep_start', { tabId: 1 });
    expect(mockServer.send).toHaveBeenCalledWith('network:deep:start', { tabId: 1 }, undefined);
  });

  it('passes params through', async () => {
    await bridge.call('navigate', { url: 'https://example.com', tabId: 2 });
    expect(mockServer.send).toHaveBeenCalledWith('navigate', { url: 'https://example.com', tabId: 2 }, undefined);
  });

  it('throws on unknown tool', async () => {
    await expect(bridge.call('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent');
  });

  it('throws when extension not connected', async () => {
    (mockServer.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);
    await expect(bridge.call('navigate', { url: 'https://x.com' })).rejects.toThrow('Extension not connected');
  });
});

describe('METHOD_MAP', () => {
  it('has 12 tool mappings', () => {
    expect(Object.keys(METHOD_MAP).length).toBe(12);
  });

  it('maps underscores to colons for network tools', () => {
    expect(METHOD_MAP['network_deep_start']).toBe('network:deep:start');
    expect(METHOD_MAP['network_deep_stop']).toBe('network:deep:stop');
    expect(METHOD_MAP['network_get_response_body']).toBe('network:getResponseBody');
  });

  it('maps inspect tools', () => {
    expect(METHOD_MAP['inspect_start']).toBe('inspect:start');
    expect(METHOD_MAP['inspect_stop']).toBe('inspect:stop');
  });

  it('keeps simple names unchanged', () => {
    expect(METHOD_MAP['navigate']).toBe('navigate');
    expect(METHOD_MAP['screenshot']).toBe('screenshot');
    expect(METHOD_MAP['click']).toBe('click');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/bridge.test.ts`
Expected: FAIL — module not found

**Step 3: Implement bridge.ts**

```typescript
// server/src/bridge.ts
import type { ExtensionServer } from './wsServer.js';

/** MCP tool name → extension protocol method */
export const METHOD_MAP: Record<string, string> = {
  navigate: 'navigate',
  inspect: 'inspect',
  inspect_start: 'inspect:start',
  inspect_stop: 'inspect:stop',
  query_dom: 'query DOM',
  click: 'click',
  type: 'type',
  scroll: 'scroll',
  screenshot: 'screenshot',
  network_deep_start: 'network:deep:start',
  network_deep_stop: 'network:deep:stop',
  network_get_response_body: 'network:getResponseBody',
};

export class Bridge {
  constructor(private readonly server: ExtensionServer) {}

  async call(toolName: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const method = METHOD_MAP[toolName];
    if (!method) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    if (!this.server.isConnected()) {
      throw new Error('Extension not connected');
    }

    return this.server.send(method, params, timeoutMs);
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run server/src/bridge.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add server/src/bridge.ts server/src/bridge.test.ts
git commit -m "feat(server): add bridge for tool-to-protocol mapping"
```

---

### Task 4: MCP server — tool registration

**Files:**
- Create: `server/src/mcp.ts`
- Create: `server/src/mcp.test.ts`

**Step 1: Write failing tests**

```typescript
// server/src/mcp.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMcpServer, TOOL_DEFINITIONS } from './mcp.js';
import type { Bridge } from './bridge.js';

function createMockBridge() {
  return {
    call: vi.fn(async () => ({ success: true })),
  } as unknown as Bridge;
}

describe('TOOL_DEFINITIONS', () => {
  it('defines 12 tools', () => {
    expect(TOOL_DEFINITIONS.length).toBe(12);
  });

  it('every tool has name, description, and inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeTruthy();
    }
  });

  it('navigate requires url', () => {
    const nav = TOOL_DEFINITIONS.find(t => t.name === 'navigate');
    expect(nav).toBeDefined();
  });

  it('screenshot has no required params', () => {
    const ss = TOOL_DEFINITIONS.find(t => t.name === 'screenshot');
    expect(ss).toBeDefined();
  });
});

describe('createMcpServer', () => {
  it('returns an McpServer instance', () => {
    const bridge = createMockBridge();
    const server = createMcpServer(bridge);
    expect(server).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run server/src/mcp.test.ts`
Expected: FAIL — module not found

**Step 3: Implement mcp.ts**

```typescript
// server/src/mcp.ts
import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Bridge } from './bridge.js';

const optionalTabId = z.number().int().positive().optional().describe('Target tab ID. Omit for active tab.');

export const TOOL_DEFINITIONS = [
  {
    name: 'navigate',
    description: 'Navigate a browser tab to a URL',
    inputSchema: z.object({
      url: z.url().describe('URL to navigate to (http/https)'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'inspect',
    description: 'Get detailed info about a DOM element by CSS selector',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'inspect_start',
    description: 'Start interactive DOM picker mode — user clicks an element to inspect it',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'inspect_stop',
    description: 'Stop interactive DOM picker mode',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'query_dom',
    description: 'Query DOM elements matching a CSS selector, returns array of element summaries',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'click',
    description: 'Click a DOM element by CSS selector',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of element to click'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'type',
    description: 'Type text into a DOM element (input, textarea, contenteditable)',
    inputSchema: z.object({
      selector: z.string().optional().describe('CSS selector of input element'),
      text: z.string().describe('Text to type'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'scroll',
    description: 'Scroll the page or a specific element',
    inputSchema: z.object({
      x: z.number().optional().describe('Horizontal scroll pixels'),
      y: z.number().optional().describe('Vertical scroll pixels'),
      selector: z.string().optional().describe('CSS selector of element to scroll'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'screenshot',
    description: 'Capture a screenshot of the visible tab area, returns base64 PNG data URL',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'network_deep_start',
    description: 'Start deep network capture via Chrome DevTools Protocol (CDP) — captures request/response bodies',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'network_deep_stop',
    description: 'Stop deep network capture',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'network_get_response_body',
    description: 'Get the response body of a captured network request by requestId',
    inputSchema: z.object({
      requestId: z.string().describe('Network request ID from a captured request event'),
      tabId: optionalTabId,
    }),
  },
] as const;

export function createMcpServer(bridge: Bridge): McpServer {
  const server = new McpServer({
    name: 'browser-controls',
    version: '0.1.0',
  });

  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (params) => {
        try {
          const result = await bridge.call(tool.name, params as Record<string, unknown>);

          // Screenshot returns base64 data URL — use image content type
          if (tool.name === 'screenshot' && typeof result === 'object' && result !== null) {
            const r = result as { dataUrl?: string; tabId?: number };
            if (r.dataUrl && typeof r.dataUrl === 'string') {
              // Extract base64 data from data URL
              const match = r.dataUrl.match(/^data:image\/png;base64,(.+)$/);
              if (match?.[1]) {
                return {
                  content: [
                    { type: 'image' as const, data: match[1], mimeType: 'image/png' },
                    { type: 'text' as const, text: `Screenshot captured (tab ${r.tabId ?? 'active'})` },
                  ],
                };
              }
            }
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
```

**Step 4: Run tests**

Run: `npx vitest run server/src/mcp.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add server/src/mcp.ts server/src/mcp.test.ts
git commit -m "feat(server): register 12 MCP tools with zod schemas"
```

---

### Task 5: Entry point — CLI, startup, shutdown

**Files:**
- Create: `server/src/index.ts`
- Create: `server/src/index.test.ts`

**Step 1: Write failing test**

```typescript
// server/src/index.test.ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from './index.js';

describe('parseArgs', () => {
  it('returns defaults with no args', () => {
    const result = parseArgs([]);
    expect(result.port).toBe(8765);
    expect(result.token).toBeUndefined();
  });

  it('parses --port', () => {
    const result = parseArgs(['--port', '9000']);
    expect(result.port).toBe(9000);
  });

  it('parses --token', () => {
    const result = parseArgs(['--token', 'mysecret']);
    expect(result.token).toBe('mysecret');
  });

  it('reads BROWSER_CONTROLS_PORT env', () => {
    const result = parseArgs([], { BROWSER_CONTROLS_PORT: '7777' });
    expect(result.port).toBe(7777);
  });

  it('CLI overrides env', () => {
    const result = parseArgs(['--port', '9000'], { BROWSER_CONTROLS_PORT: '7777' });
    expect(result.port).toBe(9000);
  });

  it('reads BROWSER_CONTROLS_TOKEN env', () => {
    const result = parseArgs([], { BROWSER_CONTROLS_TOKEN: 'envtoken' });
    expect(result.token).toBe('envtoken');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run server/src/index.test.ts`
Expected: FAIL — module not found

**Step 3: Implement index.ts**

```typescript
#!/usr/bin/env node
// server/src/index.ts
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { ExtensionServer } from './wsServer.js';
import { Bridge } from './bridge.js';
import { createMcpServer } from './mcp.js';

export interface ServerConfig {
  port: number;
  token?: string;
}

export function parseArgs(
  args: string[],
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): ServerConfig {
  let port = 8765;
  let token: string | undefined;

  // Env defaults
  const envPort = env['BROWSER_CONTROLS_PORT'];
  if (envPort !== undefined) {
    const parsed = parseInt(envPort, 10);
    if (!isNaN(parsed)) port = parsed;
  }
  const envToken = env['BROWSER_CONTROLS_TOKEN'];
  if (envToken !== undefined) {
    token = envToken;
  }

  // CLI overrides
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1] !== undefined) {
      const parsed = parseInt(args[i + 1]!, 10);
      if (!isNaN(parsed)) port = parsed;
      i++;
    } else if (arg === '--token' && args[i + 1] !== undefined) {
      token = args[i + 1]!;
      i++;
    }
  }

  const config: ServerConfig = { port };
  if (token !== undefined) {
    config.token = token;
  }
  return config;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));

  // Start WebSocket server for extension
  const extensionServer = new ExtensionServer({
    port: config.port,
    ...(config.token !== undefined ? { token: config.token } : {}),
  });
  const actualPort = await extensionServer.start();
  console.error(`[browser-controls] WebSocket server listening on port ${actualPort}`);

  // Create bridge and MCP server
  const bridge = new Bridge(extensionServer);
  const mcpServer = createMcpServer(bridge);

  // Connect MCP server to stdio transport
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[browser-controls] MCP server ready on stdio');

  // Graceful shutdown
  const shutdown = async () => {
    console.error('[browser-controls] Shutting down...');
    extensionServer.close();
    await mcpServer.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only run main when executed directly (not imported for testing)
const isDirectRun = process.argv[1]?.endsWith('index.js') || process.argv[1]?.endsWith('index.ts');
if (isDirectRun) {
  main().catch((err) => {
    console.error('[browser-controls] Fatal:', err);
    process.exit(1);
  });
}
```

**Step 4: Run tests**

Run: `npx vitest run server/src/index.test.ts`
Expected: All PASS

**Step 5: Commit**

```bash
git add server/src/index.ts server/src/index.test.ts
git commit -m "feat(server): add CLI entry point with arg parsing"
```

---

### Task 6: Integration test — full round-trip

**Files:**
- Create: `server/src/integration.test.ts`

**Step 1: Write integration test**

```typescript
// server/src/integration.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { ExtensionServer } from './wsServer.js';
import { Bridge } from './bridge.js';

describe('Integration: bridge → extension round-trip', () => {
  let server: ExtensionServer;
  let extensionWs: WebSocket;

  afterEach(() => {
    extensionWs?.close();
    server?.close();
  });

  async function setup(): Promise<{ bridge: Bridge; port: number }> {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();
    const bridge = new Bridge(server);

    extensionWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => extensionWs.on('open', resolve));

    // Complete handshake
    extensionWs.send(JSON.stringify({
      type: 'hello',
      version: '1.0.0',
      permissions: [],
      tabs: [{ id: 1, url: 'https://example.com', title: 'Test', active: true }],
    }));

    // Wait for hello_ack
    await new Promise<void>((resolve) => {
      extensionWs.once('message', () => resolve());
    });

    // Simulate extension responding to requests
    extensionWs.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === 'request') {
        extensionWs.send(JSON.stringify({
          id: msg.id,
          type: 'response',
          result: { navigated: true, url: (msg.params as Record<string, unknown>).url },
        }));
      }
    });

    return { bridge, port };
  }

  it('sends command and receives response', async () => {
    const { bridge } = await setup();

    const result = await bridge.call('navigate', { url: 'https://example.com' });
    expect(result).toEqual({ navigated: true, url: 'https://example.com' });
  });

  it('returns error when extension not connected', async () => {
    server = new ExtensionServer({ port: 0 });
    await server.start();
    const bridge = new Bridge(server);

    await expect(bridge.call('navigate', { url: 'https://example.com' }))
      .rejects.toThrow('Extension not connected');
  });

  it('propagates extension errors', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();
    const bridge = new Bridge(server);

    extensionWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => extensionWs.on('open', resolve));

    extensionWs.send(JSON.stringify({
      type: 'hello', version: '1.0.0', permissions: [], tabs: [],
    }));
    await new Promise<void>((resolve) => extensionWs.once('message', () => resolve()));

    // Simulate extension error response
    extensionWs.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === 'request') {
        extensionWs.send(JSON.stringify({
          id: msg.id,
          type: 'response',
          error: { code: 'INVALID_URL', message: 'Bad URL' },
        }));
      }
    });

    await expect(bridge.call('navigate', { url: 'bad' }))
      .rejects.toThrow('Bad URL');
  });
});
```

**Step 2: Run integration test**

Run: `npx vitest run server/src/integration.test.ts`
Expected: All PASS

**Step 3: Commit**

```bash
git add server/src/integration.test.ts
git commit -m "test(server): add integration test for full round-trip"
```

---

### Task 7: Build setup and README

**Files:**
- Modify: `package.json` (root — add server scripts)
- Modify: `README.md` (add MCP server section)

**Step 1: Update root package.json**

Add to scripts:

```json
{
  "scripts": {
    "server:build": "cd server && npm run build",
    "server:start": "node server/dist/index.js"
  }
}
```

**Step 2: Add shebang line to server/src/index.ts** (already included in Task 5)

**Step 3: Update README.md — append MCP server section**

Add a section to README.md:

```markdown
## MCP Server

Bridge between AI agents (via MCP stdio) and the Chrome extension (via WebSocket).

### Setup

```bash
cd server && npm install
npm run build
```

### Usage with Claude Desktop

Add to `claude_desktop_config.json`:

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

### CLI Options

| Flag | Env Var | Default | Description |
|------|---------|---------|-------------|
| `--port` | `BROWSER_CONTROLS_PORT` | 8765 | WebSocket port |
| `--token` | `BROWSER_CONTROLS_TOKEN` | — | Auth token |

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
```

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add package.json README.md
git commit -m "docs: add MCP server setup and usage"
```

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Package scaffolding | `server/package.json`, `server/tsconfig.json`, root configs |
| 2 | WebSocket server | `server/src/wsServer.ts` + test |
| 3 | Bridge (tool→protocol) | `server/src/bridge.ts` + test |
| 4 | MCP tool registration | `server/src/mcp.ts` + test |
| 5 | CLI entry point | `server/src/index.ts` + test |
| 6 | Integration test | `server/src/integration.test.ts` |
| 7 | Build + README | root `package.json`, `README.md` |
