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
