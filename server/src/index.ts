#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
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
