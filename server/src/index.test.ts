import { describe, it, expect } from 'vitest';
import { parseArgs } from './index.js';

describe('parseArgs', () => {
  it('returns defaults with no args', () => {
    const result = parseArgs([]);
    expect(result.port).toBe(8765);
    expect(result.token).toBeUndefined();
    expect(result.daemon).toBeUndefined();
  });

  it('parses --port', () => {
    const result = parseArgs(['--port', '9000']);
    expect(result.port).toBe(9000);
  });

  it('parses --token', () => {
    const result = parseArgs(['--token', 'mysecret']);
    expect(result.token).toBe('mysecret');
  });

  it('parses --daemon', () => {
    const result = parseArgs(['--daemon']);
    expect(result.daemon).toBe(true);
  });

  it('parses --daemon with other flags', () => {
    const result = parseArgs(['--daemon', '--port', '9000', '--token', 'secret']);
    expect(result.daemon).toBe(true);
    expect(result.port).toBe(9000);
    expect(result.token).toBe('secret');
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
