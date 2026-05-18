import { parseAgentMessage, toProtocolError, AgentRequest, AgentResponse, ProtocolError, AgentEvent } from '../shared/protocol.js';

export type RequestHandler = (request: AgentRequest) => Promise<unknown> | unknown;

export interface WebSocketFactory {
  create(url: string): WebSocket;
}

export interface SocketOptions {
  url?: string;
  token?: string;
  wsFactory?: WebSocketFactory;
}

export class AgentSocket {
  private ws: WebSocket | null = null;
  private requestHandler: RequestHandler | null = null;
  private onOpenCallbacks: Array<() => void> = [];
  private onCloseCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: Error) => void> = [];
  private wsFactory: WebSocketFactory;
  private url!: string;
  private token?: string;

  /**
   * @param options - Socket configuration options
   * @param options.url - WebSocket URL (default: ws://localhost:8765)
   * @param options.token - Optional authentication token
   * @param options.wsFactory - Optional WebSocket factory for testing
   */
  constructor(options: SocketOptions = {}) {
    // With exactOptionalPropertyTypes, we need to handle undefined explicitly
    const _url: string = options.url !== undefined ? options.url : 'ws://localhost:8765';
    this.url = _url;
    if (options.token !== undefined) { this.token = options.token; }
    this.wsFactory = options.wsFactory ?? {
      create: (url: string) => new WebSocket(url),
    };
  }

  /**
   * Establish WebSocket connection. Fetches manifest version and tabs, then sends hello.
   * No-op if already connected.
   */
  async connect(): Promise<void> {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED && this.ws.readyState !== WebSocket.CLOSING) {
      return; // Already connected or connecting
    }

    const [version, tabs] = await Promise.all([
      this.getManifestVersion(),
      this.getTabs(),
    ]);

    this.ws = this.wsFactory.create(this.url);

    this.ws.onopen = () => {
      if (!this.sendHello(version, tabs, this.token)) {
        this.onErrorCallbacks.forEach(cb => cb(new Error('Failed to send hello message')));
      }
      this.onOpenCallbacks.forEach(cb => cb());
    };

    this.ws.onclose = () => {
      this.onCloseCallbacks.forEach(cb => cb());
    };

    this.ws.onerror = () => {
      const error = new Error('WebSocket error');
      this.onErrorCallbacks.forEach(cb => cb(error));
    };

    this.ws.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private getManifestVersion(): string {
    return chrome.runtime.getManifest().version;
  }

  private async getTabs(): Promise<Array<{ id: number; url?: string; title?: string; active: boolean }>> {
    const tabs = await chrome.tabs.query({});
    return tabs
      .filter(tab => tab.id !== undefined)
      .map(tab => {
        const result: { id: number; url?: string; title?: string; active: boolean } = {
          id: tab.id!,
          active: tab.active,
        };
        if (tab.url !== undefined) {
          result.url = tab.url;
        }
        if (tab.title !== undefined) {
          result.title = tab.title;
        }
        return result;
      });
  }

  /**
   * Send hello message. Returns false if socket is not open.
   */
  private sendHello(version: string, tabs: Array<{ id: number; url?: string; title?: string; active: boolean }>, token?: string): boolean {
    const hello: {
      type: 'hello';
      version: string;
      permissions: string[];
      tabs: Array<{ id: number; url?: string; title?: string; active: boolean }>;
      token?: string;
    } = {
      type: 'hello',
      version,
      permissions: chrome.runtime.getManifest().permissions as string[],
      tabs,
    };
    if (token) {
      hello.token = token;
    }
    return this.send(hello);
  }

  private handleMessage(data: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch {
      // If JSON parsing fails, treat as protocol error
      this.sendProtocolError({ id: 'unknown', type: 'request' }, 'Invalid JSON format');
      return;
    }

    try {
      const message = parseAgentMessage(parsed);

      // Ignore hello_ack messages
      if (message.type === 'hello_ack') {
        return;
      }

      // Handle request messages
      if (message.type === 'request') {
        if (!this.requestHandler) {
          // Send error if no handler registered
          this.sendResponse(message.id, {
            error: {
              code: 'NO_REQUEST_HANDLER',
              message: 'No request handler registered',
            },
          });
          return;
        }
        this.dispatchRequest(message as AgentRequest);
      }
    } catch (err) {
      // Protocol error - try to extract request ID if available
      const requestId = typeof parsed === 'object' && parsed !== null && 'id' in parsed
        ? String((parsed as { id: unknown }).id)
        : 'unknown';
      this.sendProtocolError({ id: requestId, type: 'request' }, err instanceof Error ? err.message : String(err));
    }
  }

  private async dispatchRequest(request: AgentRequest): Promise<void> {
    try {
      const result = await this.requestHandler!(request);
      this.sendResponse(request.id, { result });
    } catch (err) {
      this.sendResponse(request.id, { error: toProtocolError(err) });
    }
  }

  private sendResponse(id: string, payload: { result?: unknown; error?: ProtocolError }): void {
    const response: AgentResponse = {
      id,
      type: 'response',
      ...payload,
    };
    if (!this.send(response)) {
      this.onErrorCallbacks.forEach(cb => cb(new Error('Failed to send response')));
    }
  }

  private sendProtocolError(request: { id: string; type: string }, message: string): void {
    this.sendResponse(request.id, {
      error: {
        code: 'PROTOCOL_ERROR',
        message,
      },
    });
  }

  /**
   * Send data over WebSocket. Returns false if socket is not open.
   */
  private send(data: unknown): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * Send an event to the connected agent.
   * @param event - Event name (e.g., 'network:request')
   * @param payload - Event payload data
   * @param tabId - Optional tab ID to include at top-level of the event envelope
   */
  sendEvent(event: string, payload: Record<string, unknown>, tabId?: number): boolean {
    const eventMessage: AgentEvent = {
      type: 'event',
      event,
      payload,
    };
    if (tabId !== undefined) {
      eventMessage.tabId = tabId;
    }
    return this.send(eventMessage);
  }

  onOpen(callback: () => void): void {
    this.onOpenCallbacks.push(callback);
  }

  onClose(callback: () => void): void {
    this.onCloseCallbacks.push(callback);
  }

  onError(callback: (error: Error) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  onRequest(handler: RequestHandler): void {
    this.requestHandler = handler;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Create and export default socket instance for background script
let agentSocket: AgentSocket | null = null;

export function getAgentSocket(): AgentSocket {
  if (!agentSocket) {
    agentSocket = new AgentSocket({ url: 'ws://localhost:8765' });
  }
  return agentSocket;
}

export function createAgentSocket(options: SocketOptions = {}): AgentSocket {
  agentSocket = new AgentSocket(options);
  return agentSocket;
}