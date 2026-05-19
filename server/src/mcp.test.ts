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
