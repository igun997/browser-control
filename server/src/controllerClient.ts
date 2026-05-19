import { randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { CommandSender } from './types.js';

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

interface RequestMessage {
  id: string;
  type: 'request';
  method: string;
  params: Record<string, unknown>;
}

interface ResponseMessage {
  type: 'response';
  id: string;
  result?: unknown;
  error?: { code: string; message: string };
}

type PendingResolve = (value: unknown) => void;
type PendingReject = (reason: Error) => void;

interface PendingEntry {
  resolve: PendingResolve;
  reject: PendingReject;
  timer: ReturnType<typeof setTimeout>;
}

export interface ControllerClientOptions {
  port: number;
  token?: string;
}

export class ControllerClient implements CommandSender {
  private ws: WebSocket | null = null;
  private readonly port: number;
  private readonly token?: string;
  private readonly pending = new Map<string, PendingEntry>();
  private extensionConnected = false;
  private handshakeResolve: ((ack: ControllerHelloAck) => void) | null = null;
  private handshakeReject: ((reason: Error) => void) | null = null;
  private handshakeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: ControllerClientOptions) {
    this.port = options.port;
    if (options.token !== undefined) {
      this.token = options.token;
    }
  }

  /** Connect to daemon and complete handshake. */
  connect(): Promise<ControllerHelloAck> {
    return new Promise((resolve, reject) => {
      this.handshakeResolve = resolve;
      this.handshakeReject = reject;

      this.ws = new WebSocket(`ws://localhost:${this.port}`);

      this.handshakeTimer = setTimeout(() => {
        if (this.handshakeReject) {
          this.handshakeReject(new Error('Handshake timeout'));
          this.handshakeReject = null;
          this.handshakeResolve = null;
        }
        this.ws?.close();
      }, 5000);

      this.ws.on('open', () => {
        const hello: ControllerHelloMessage = { type: 'controller_hello' };
        if (this.token !== undefined) {
          hello.token = this.token;
        }
        this.ws!.send(JSON.stringify(hello));
      });

      this.ws.on('message', (data) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (err) => {
        this.clearHandshakeTimer();
        if (this.handshakeReject) {
          this.handshakeReject(err);
          this.handshakeReject = null;
          this.handshakeResolve = null;
        }
      });

      this.ws.on('close', () => {
        this.clearHandshakeTimer();
        this.rejectAllPending('Connection closed');
        if (this.handshakeReject) {
          this.handshakeReject(new Error('Connection closed before handshake'));
          this.handshakeReject = null;
          this.handshakeResolve = null;
        }
      });
    });
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    if (msg.type === 'controller_hello_ack') {
      if (typeof msg.sessionId !== 'string' || typeof msg.extensionConnected !== 'boolean') {
        if (this.handshakeReject) {
          this.handshakeReject(new Error('Invalid controller_hello_ack'));
          this.handshakeReject = null;
          this.handshakeResolve = null;
        }
        return;
      }
      const ack = msg as unknown as ControllerHelloAck;
      this.extensionConnected = ack.extensionConnected;
      this.clearHandshakeTimer();
      if (this.handshakeResolve) {
        this.handshakeResolve(ack);
        this.handshakeResolve = null;
        this.handshakeReject = null;
      }
      return;
    }

    if (msg.type === 'extension_status') {
      const status = msg as unknown as ExtensionStatusNotification;
      this.extensionConnected = status.connected;
      return;
    }

    if (msg.type === 'response' && typeof msg.id === 'string') {
      const response = msg as unknown as ResponseMessage;
      const entry = this.pending.get(response.id);
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(response.id);
        if (response.error) {
          const error = new Error(response.error.message);
          (error as Error & { code: string }).code = response.error.code;
          entry.reject(error);
        } else {
          entry.resolve(response.result);
        }
      }
      return;
    }
  }

  /** Send a command to extension through daemon and await response. */
  send(method: string, params: Record<string, unknown>, timeoutMs = 30000): Promise<unknown> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('Not connected'));
    }
    if (!this.extensionConnected) {
      return Promise.reject(new Error('Extension not connected'));
    }

    const id = randomUUID();

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Command timeout'));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      const request: RequestMessage = {
        id,
        type: 'request',
        method,
        params,
      };

      this.ws!.send(JSON.stringify(request));
    });
  }

  isConnected(): boolean {
    return this.extensionConnected;
  }

  close(): void {
    this.clearHandshakeTimer();
    this.rejectAllPending('Client closing');
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.extensionConnected = false;
    this.handshakeResolve = null;
    this.handshakeReject = null;
  }

  private clearHandshakeTimer(): void {
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer);
      this.handshakeTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
