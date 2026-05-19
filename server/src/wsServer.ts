import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

/** Matches extension HelloMessage shape — inlined to avoid cross-package import */
interface HelloMessage {
  type: 'hello';
  version: string;
  permissions: string[];
  tabs: Array<{ id: number; url?: string; title?: string; active: boolean }>;
  token?: string;
}

interface ControllerHelloMessage {
  type: 'controller_hello';
  token?: string;
}

interface ControllerHelloAck {
  type: 'controller_hello_ack';
  sessionId: string;
  extensionConnected: boolean;
}

interface ExtensionStatusNotification {
  type: 'extension_status';
  connected: boolean;
}

export interface ExtensionServerOptions {
  port: number;
  token?: string;
}

type PendingResolve = (value: unknown) => void;
type PendingReject = (reason: Error) => void;

interface PendingEntry {
  resolve: PendingResolve;
  reject: PendingReject;
  timer: ReturnType<typeof setTimeout>;
  controllerId: string;
}

export class ExtensionServer {
  private wss: WebSocketServer | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private readonly port: number;
  private readonly token?: string;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly controllers = new Map<string, WebSocket>();
  private readonly controllerRequests = new Map<string, string>(); // requestId → controllerId

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
        const actualPort = typeof addr === 'object' && addr !== null ? addr.port : this.port;
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

        if (msg.type === 'controller_hello') {
          this.handleControllerHello(ws, msg as unknown as ControllerHelloMessage);
          return;
        }

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

        // Notify controllers that extension is connected
        this.broadcastExtensionStatus(true);

        // Wire up message and close handlers
        ws.on('message', (raw) => {
          this.handleMessage(raw.toString());
        });

        ws.on('close', () => {
          if (this.ws === ws) {
            this.connected = false;
            this.ws = null;
            this.rejectAllPending('Extension disconnected');
            this.broadcastExtensionStatus(false);
          }
        });
      } catch {
        ws.close(4000, 'Invalid hello');
      }
    });
  }

  private handleControllerHello(ws: WebSocket, msg: ControllerHelloMessage): void {
    // Validate token if configured
    if (this.token !== undefined) {
      if (msg.token !== this.token) {
        ws.close(4001, 'Invalid token');
        return;
      }
    }

    const sessionId = randomUUID();
    this.controllers.set(sessionId, ws);

    const ack: ControllerHelloAck = {
      type: 'controller_hello_ack',
      sessionId,
      extensionConnected: this.connected,
    };
    ws.send(JSON.stringify(ack));

    ws.on('message', (raw) => {
      this.handleControllerMessage(sessionId, raw.toString());
    });

    ws.on('close', () => {
      this.controllers.delete(sessionId);
      // Clean up pending requests from this controller
      for (const [requestId, controllerId] of this.controllerRequests) {
        if (controllerId === sessionId) {
          const entry = this.pending.get(requestId);
          if (entry) {
            clearTimeout(entry.timer);
            entry.reject(new Error('Controller disconnected'));
            this.pending.delete(requestId);
          }
          this.controllerRequests.delete(requestId);
        }
      }
    });
  }

  private handleControllerMessage(controllerId: string, raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // Ignore unparseable
    }

    if (msg.type === 'request' && typeof msg.id === 'string') {
      const requestId = msg.id;
      this.controllerRequests.set(requestId, controllerId);

      if (!this.connected || !this.ws) {
        // Send error response back to controller
        const controller = this.controllers.get(controllerId);
        if (controller) {
          controller.send(JSON.stringify({
            type: 'response',
            id: requestId,
            error: { code: 'EXTENSION_NOT_CONNECTED', message: 'Extension not connected' },
          }));
        }
        this.controllerRequests.delete(requestId);
        return;
      }

      // Forward request to extension
      const forward = { ...msg };
      this.ws.send(JSON.stringify(forward));
    }
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // Ignore unparseable
    }

    // Handle responses to pending requests (in-process send())
    if (msg.type === 'response' && typeof msg.id === 'string') {
      const entry = this.pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);
        this.controllerRequests.delete(msg.id);

        if (msg.error) {
          const err = msg.error as { code: string; message: string };
          const error = new Error(err.message);
          (error as Error & { code: string }).code = err.code;
          entry.reject(error);
        } else {
          entry.resolve(msg.result);
        }
        return;
      }

      // Route extension response back to the controller that sent the request
      const controllerId = this.controllerRequests.get(msg.id);
      if (controllerId) {
        const controller = this.controllers.get(controllerId);
        if (controller) {
          controller.send(JSON.stringify(msg));
        }
        this.controllerRequests.delete(msg.id);
      }
    }

    // Broadcast extension events to all controllers
    if (msg.type === 'event') {
      for (const controller of this.controllers.values()) {
        controller.send(JSON.stringify(msg));
      }
    }
  }

  private broadcastExtensionStatus(connected: boolean): void {
    const notification: ExtensionStatusNotification = {
      type: 'extension_status',
      connected,
    };
    for (const controller of this.controllers.values()) {
      controller.send(JSON.stringify(notification));
    }
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

      this.pending.set(id, { resolve, reject, timer, controllerId: '' });

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
    for (const ws of this.controllers.values()) {
      ws.close();
    }
    this.controllers.clear();
    this.controllerRequests.clear();
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
    this.controllerRequests.clear();
  }
}
