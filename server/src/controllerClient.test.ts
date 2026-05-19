import { describe, it, expect, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { ExtensionServer } from './wsServer.js';
import { ControllerClient } from './controllerClient.js';

describe('ControllerClient', () => {
  let server: ExtensionServer;
  let client: ControllerClient;

  afterEach(() => {
    client?.close();
    server?.close();
  });

  it('connects and completes controller_hello/ack handshake', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    client = new ControllerClient({ port });
    const ack = await client.connect();

    expect(ack.type).toBe('controller_hello_ack');
    expect(typeof ack.sessionId).toBe('string');
    expect(ack.extensionConnected).toBe(false);
  });

  it('send() sends request through WS, resolves with response from daemon', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    // Connect extension
    const extWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => extWs.on('open', resolve));
    extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
    await new Promise((r) => setTimeout(r, 50));

    // Extension responds to requests
    extWs.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === 'request') {
        extWs.send(JSON.stringify({
          id: msg.id,
          type: 'response',
          result: { success: true, method: msg.method },
        }));
      }
    });

    client = new ControllerClient({ port });
    await client.connect();

    const result = await client.send('testMethod', { foo: 'bar' });
    expect(result).toEqual({ success: true, method: 'testMethod' });

    extWs.close();
  });

  it('timeout rejects pending requests', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    // Connect extension but don't respond
    const extWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => extWs.on('open', resolve));
    extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
    await new Promise((r) => setTimeout(r, 50));

    client = new ControllerClient({ port });
    await client.connect();

    await expect(client.send('slowMethod', {}, 50)).rejects.toThrow('Command timeout');

    extWs.close();
  });

  it('isConnected() tracks extension status from extension_status notifications', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    client = new ControllerClient({ port });
    await client.connect();
    expect(client.isConnected()).toBe(false);

    // Connect extension
    const extWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => extWs.on('open', resolve));
    extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
    await new Promise((r) => setTimeout(r, 50));

    expect(client.isConnected()).toBe(true);

    extWs.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(client.isConnected()).toBe(false);
  });

  it('token auth sent in controller_hello handshake', async () => {
    server = new ExtensionServer({ port: 0, token: 'secret123' });
    const port = await server.start();

    client = new ControllerClient({ port, token: 'secret123' });
    const ack = await client.connect();

    expect(ack.type).toBe('controller_hello_ack');
  });

  it('token auth rejects wrong token', async () => {
    server = new ExtensionServer({ port: 0, token: 'secret123' });
    const port = await server.start();

    client = new ControllerClient({ port, token: 'wrong' });
    await expect(client.connect()).rejects.toThrow();
  });

  it('close() closes WS and rejects pending', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    // Connect extension but don't respond
    const extWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => extWs.on('open', resolve));
    extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
    await new Promise((r) => setTimeout(r, 50));

    client = new ControllerClient({ port });
    await client.connect();

    const sendPromise = client.send('slowMethod', {}, 10000);
    client.close();

    await expect(sendPromise).rejects.toThrow('Client closing');
  });

  it('propagates extension error responses', async () => {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();

    // Connect extension
    const extWs = new WebSocket(`ws://localhost:${port}`);
    await new Promise<void>((resolve) => extWs.on('open', resolve));
    extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
    await new Promise((r) => setTimeout(r, 50));

    extWs.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as Record<string, unknown>;
      if (msg.type === 'request') {
        extWs.send(JSON.stringify({
          id: msg.id,
          type: 'response',
          error: { code: 'INVALID_PARAM', message: 'Bad parameter' },
        }));
      }
    });

    client = new ControllerClient({ port });
    await client.connect();

    await expect(client.send('badMethod', {})).rejects.toThrow('Bad parameter');

    extWs.close();
  });
});
