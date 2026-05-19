import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { HelloMessage } from '../../extension/src/shared/protocol.js';

export interface ExtensionServerOptions {
  port: number;
  token?: string;
}

type PendingResolve = (value: unknown) => void;
type PendingReject = (reason: Error) => void;

export class ExtensionServer {
  private wss: WebSocketServer | null = null;
  private ws: WebSocket | null = null;
  private connected = false;
  private readonly port: number;
  private readonly token?: string;
  private readonly pending = new Map<string, { resolve: PendingResolve; reject: PendingReject; timer: ReturnType<typeof setTimeout> }>();

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
        const actualPort = typeof addr === 'object' ? addr.port : this.port;
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

        // Wire up message and close handlers
        ws.on('message', (raw) => {
          this.handleMessage(raw.toString());
        });

        ws.on('close', () => {
          if (this.ws === ws) {
            this.connected = false;
            this.ws = null;
            this.rejectAllPending('Extension disconnected');
          }
        });
      } catch {
        ws.close(4000, 'Invalid hello');
      }
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return; // Ignore unparseable
    }

    // Handle responses to pending requests
    if (msg.type === 'response' && typeof msg.id === 'string') {
      const entry = this.pending.get(msg.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(msg.id);

        if (msg.error) {
          const err = msg.error as { code: string; message: string };
          const error = new Error(err.message);
          (error as Error & { code: string }).code = err.code;
          entry.reject(error);
        } else {
          entry.resolve(msg.result);
        }
      }
    }
    // Events from extension are ignored for now (v1 — no MCP event streaming)
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

      this.pending.set(id, { resolve, reject, timer });

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
  }
}
