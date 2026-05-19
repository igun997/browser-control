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
