import { describe, it, expect, afterEach } from 'vitest';
import WebSocket from 'ws';
import { ExtensionServer } from './wsServer.js';
import { ControllerClient } from './controllerClient.js';

describe('Integration: daemon + controller + extension round-trip', () => {
  let server: ExtensionServer;
  const clients: ControllerClient[] = [];
  const extensions: WebSocket[] = [];

  afterEach(() => {
    for (const client of clients) client.close();
    clients.length = 0;
    for (const ext of extensions) ext.close();
    extensions.length = 0;
    server?.close();
  });

  async function setupDaemon(): Promise<{ port: number }> {
    server = new ExtensionServer({ port: 0 });
    const port = await server.start();
    return { port };
  }

  async function connectMockExtension(port: number, respond?: (msg: Record<string, unknown>) => unknown): Promise<WebSocket> {
    const ws = new WebSocket(`ws://localhost:${port}`);
    extensions.push(ws);

    await new Promise<void>((resolve) => ws.on('open', resolve));

    ws.send(JSON.stringify({
      type: 'hello',
      version: '1.0.0',
      permissions: [],
      tabs: [{ id: 1, url: 'https://example.com', title: 'Test', active: true }],
    }));

    await new Promise<void>((resolve) => {
      ws.once('message', () => resolve());
    });

    if (respond) {
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString()) as Record<string, unknown>;
        if (msg.type === 'request') {
          ws.send(JSON.stringify({
            id: msg.id,
            type: 'response',
            result: respond(msg),
          }));
        }
      });
    }

    return ws;
  }

  async function connectController(port: number): Promise<ControllerClient> {
    const client = new ControllerClient({ port });
    clients.push(client);
    await client.connect();
    return client;
  }

  it('sends request through controller -> daemon -> extension and back', async () => {
    const { port } = await setupDaemon();
    await connectMockExtension(port, (msg) => ({
      navigated: true,
      url: (msg.params as Record<string, unknown>).url,
    }));

    const controller = await connectController(port);
    const result = await controller.send('navigate', { url: 'https://example.com' });

    expect(result).toEqual({ navigated: true, url: 'https://example.com' });
  });

  it('multiple controllers each get correct response', async () => {
    const { port } = await setupDaemon();
    await connectMockExtension(port, (msg) => ({
      echo: (msg.params as Record<string, unknown>).value,
    }));

    const controller1 = await connectController(port);
    const controller2 = await connectController(port);

    const result1 = controller1.send('test', { value: 'from-c1' });
    const result2 = controller2.send('test', { value: 'from-c2' });

    expect(await result1).toEqual({ echo: 'from-c1' });
    expect(await result2).toEqual({ echo: 'from-c2' });
  });

  it('notifies controllers when extension disconnects', async () => {
    const { port } = await setupDaemon();
    const extWs = await connectMockExtension(port);

    const controller = await connectController(port);
    expect(controller.isConnected()).toBe(true);

    extWs.close();
    await new Promise((r) => setTimeout(r, 100));

    expect(controller.isConnected()).toBe(false);
  });
});
