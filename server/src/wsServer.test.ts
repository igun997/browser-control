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

  describe('controller support', () => {
    it('controller connects with controller_hello and receives controller_hello_ack', async () => {
      server = new ExtensionServer({ port: 0 });
      const port = await server.start();

      const controller = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => controller.on('open', resolve));

      controller.send(JSON.stringify({ type: 'controller_hello' }));

      const ack = await new Promise<Record<string, unknown>>((resolve) => {
        controller.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      expect(ack.type).toBe('controller_hello_ack');
      expect(typeof ack.sessionId).toBe('string');
      expect(ack.extensionConnected).toBe(false);

      controller.close();
    });

    it('controller request forwarded to extension', async () => {
      server = new ExtensionServer({ port: 0 });
      const port = await server.start();

      // Connect extension
      const extWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => extWs.on('open', resolve));
      extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
      await new Promise((r) => setTimeout(r, 50));

      // Collect requests received by extension
      const extRequests: Record<string, unknown>[] = [];
      extWs.on('message', (data) => {
        extRequests.push(JSON.parse(data.toString()));
      });

      // Connect controller
      const controller = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => controller.on('open', resolve));
      controller.send(JSON.stringify({ type: 'controller_hello' }));
      await new Promise<Record<string, unknown>>((resolve) => {
        controller.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Send request from controller
      controller.send(JSON.stringify({ type: 'request', id: 'req-1', method: 'testMethod', params: { foo: 'bar' } }));

      // Wait for extension to receive it
      await new Promise((r) => setTimeout(r, 50));
      expect(extRequests.length).toBe(1);
      expect(extRequests[0]).toMatchObject({ type: 'request', id: 'req-1', method: 'testMethod', params: { foo: 'bar' } });

      extWs.close();
      controller.close();
    });

    it('extension response routed back to correct controller', async () => {
      server = new ExtensionServer({ port: 0 });
      const port = await server.start();

      // Connect extension
      const extWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => extWs.on('open', resolve));
      extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
      await new Promise((r) => setTimeout(r, 50));

      // Connect controller
      const controller = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => controller.on('open', resolve));
      controller.send(JSON.stringify({ type: 'controller_hello' }));
      await new Promise<Record<string, unknown>>((resolve) => {
        controller.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Collect controller responses
      const controllerResponses: Record<string, unknown>[] = [];
      controller.on('message', (data) => {
        controllerResponses.push(JSON.parse(data.toString()));
      });

      // Send request from controller
      controller.send(JSON.stringify({ type: 'request', id: 'req-1', method: 'testMethod', params: {} }));
      await new Promise((r) => setTimeout(r, 50));

      // Extension sends response
      extWs.send(JSON.stringify({ type: 'response', id: 'req-1', result: { success: true } }));

      // Wait for controller to receive it
      await new Promise((r) => setTimeout(r, 50));
      const response = controllerResponses.find((m) => m.type === 'response');
      expect(response).toBeDefined();
      expect(response).toMatchObject({ type: 'response', id: 'req-1', result: { success: true } });

      extWs.close();
      controller.close();
    });

    it('multiple controllers get correct responses', async () => {
      server = new ExtensionServer({ port: 0 });
      const port = await server.start();

      // Connect extension
      const extWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => extWs.on('open', resolve));
      extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
      await new Promise((r) => setTimeout(r, 50));

      // Connect two controllers
      const ctrl1 = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => ctrl1.on('open', resolve));
      ctrl1.send(JSON.stringify({ type: 'controller_hello' }));
      await new Promise<Record<string, unknown>>((resolve) => {
        ctrl1.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      const ctrl2 = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => ctrl2.on('open', resolve));
      ctrl2.send(JSON.stringify({ type: 'controller_hello' }));
      await new Promise<Record<string, unknown>>((resolve) => {
        ctrl2.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Collect responses
      const ctrl1Responses: Record<string, unknown>[] = [];
      ctrl1.on('message', (data) => {
        ctrl1Responses.push(JSON.parse(data.toString()));
      });
      const ctrl2Responses: Record<string, unknown>[] = [];
      ctrl2.on('message', (data) => {
        ctrl2Responses.push(JSON.parse(data.toString()));
      });

      // Send requests from both controllers
      ctrl1.send(JSON.stringify({ type: 'request', id: 'req-ctrl1', method: 'm1', params: {} }));
      ctrl2.send(JSON.stringify({ type: 'request', id: 'req-ctrl2', method: 'm2', params: {} }));
      await new Promise((r) => setTimeout(r, 50));

      // Extension sends responses
      extWs.send(JSON.stringify({ type: 'response', id: 'req-ctrl1', result: { from: 'ctrl1' } }));
      extWs.send(JSON.stringify({ type: 'response', id: 'req-ctrl2', result: { from: 'ctrl2' } }));
      await new Promise((r) => setTimeout(r, 50));

      const r1 = ctrl1Responses.find((m) => m.type === 'response');
      const r2 = ctrl2Responses.find((m) => m.type === 'response');

      expect(r1).toMatchObject({ type: 'response', id: 'req-ctrl1', result: { from: 'ctrl1' } });
      expect(r2).toMatchObject({ type: 'response', id: 'req-ctrl2', result: { from: 'ctrl2' } });

      extWs.close();
      ctrl1.close();
      ctrl2.close();
    });

    it('token auth works for controllers', async () => {
      server = new ExtensionServer({ port: 0, token: 'secret123' });
      const port = await server.start();

      // Wrong token
      const ws1 = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => ws1.on('open', resolve));
      ws1.send(JSON.stringify({ type: 'controller_hello', token: 'wrong' }));
      const closed = new Promise<number>((resolve) => ws1.on('close', (code) => resolve(code)));
      const code = await closed;
      expect(code).toBe(4001);

      // Correct token
      const ws2 = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => ws2.on('open', resolve));
      ws2.send(JSON.stringify({ type: 'controller_hello', token: 'secret123' }));
      await new Promise((r) => setTimeout(r, 50));

      // Should still be open
      expect(ws2.readyState).toBe(WebSocket.OPEN);

      ws2.close();
    });

    it('controller disconnect cleans up pending requests', async () => {
      server = new ExtensionServer({ port: 0 });
      const port = await server.start();

      // Connect extension
      const extWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => extWs.on('open', resolve));
      extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
      await new Promise((r) => setTimeout(r, 50));

      // Connect controller
      const controller = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => controller.on('open', resolve));
      controller.send(JSON.stringify({ type: 'controller_hello' }));
      await new Promise<Record<string, unknown>>((resolve) => {
        controller.on('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      // Send request from controller (extension won't respond)
      controller.send(JSON.stringify({ type: 'request', id: 'pending-req', method: 'slow', params: {} }));
      await new Promise((r) => setTimeout(r, 50));

      // Disconnect controller
      controller.close();
      await new Promise((r) => setTimeout(r, 50));

      // Extension should still be connected and functional
      expect(server.isConnected()).toBe(true);

      extWs.close();
    });

    it('extension_status broadcast on extension connect', async () => {
      server = new ExtensionServer({ port: 0 });
      const port = await server.start();

      // Connect controller before extension
      const controller = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => controller.on('open', resolve));
      controller.send(JSON.stringify({ type: 'controller_hello' }));

      const messages: Record<string, unknown>[] = [];
      controller.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      // Wait for ack
      await new Promise((r) => setTimeout(r, 50));

      // Connect extension
      const extWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => extWs.on('open', resolve));
      extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
      await new Promise((r) => setTimeout(r, 50));

      const statusMsg = messages.find((m) => m.type === 'extension_status');
      expect(statusMsg).toBeDefined();
      expect(statusMsg?.connected).toBe(true);

      extWs.close();
      controller.close();
    });

    it('extension_status broadcast on extension disconnect', async () => {
      server = new ExtensionServer({ port: 0 });
      const port = await server.start();

      // Connect extension first
      const extWs = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => extWs.on('open', resolve));
      extWs.send(JSON.stringify({ type: 'hello', version: '1.0.0', permissions: [], tabs: [] }));
      await new Promise((r) => setTimeout(r, 50));

      // Connect controller
      const controller = new WebSocket(`ws://localhost:${port}`);
      await new Promise<void>((resolve) => controller.on('open', resolve));
      controller.send(JSON.stringify({ type: 'controller_hello' }));

      const messages: Record<string, unknown>[] = [];
      controller.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      await new Promise((r) => setTimeout(r, 50));

      // Disconnect extension
      extWs.close();
      await new Promise((r) => setTimeout(r, 50));

      const statusMsg = messages.find((m) => m.type === 'extension_status');
      expect(statusMsg).toBeDefined();
      expect(statusMsg?.connected).toBe(false);

      controller.close();
    });
  });
});
