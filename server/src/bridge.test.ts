import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bridge, METHOD_MAP } from './bridge.js';
import type { CommandSender } from './types.js';

function createMockSender() {
  return {
    isConnected: vi.fn(() => true),
    send: vi.fn(async () => ({ ok: true })),
    close: vi.fn(),
  } as unknown as CommandSender;
}

describe('Bridge', () => {
  let bridge: Bridge;
  let mockSender: ReturnType<typeof createMockSender>;

  beforeEach(() => {
    mockSender = createMockSender();
    bridge = new Bridge(mockSender);
  });

  it('maps tool name to protocol method', async () => {
    await bridge.call('network_deep_start', { tabId: 1 });
    expect(mockSender.send).toHaveBeenCalledWith('network:deep:start', { tabId: 1 }, undefined);
  });

  it('passes params through', async () => {
    await bridge.call('navigate', { url: 'https://example.com', tabId: 2 });
    expect(mockSender.send).toHaveBeenCalledWith('navigate', { url: 'https://example.com', tabId: 2 }, undefined);
  });

  it('throws on unknown tool', async () => {
    await expect(bridge.call('nonexistent', {})).rejects.toThrow('Unknown tool: nonexistent');
  });

  it('throws when extension not connected', async () => {
    (mockSender.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);
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
