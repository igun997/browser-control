import { parseAgentMessage, toProtocolError, AgentRequest, AgentResponse, ProtocolError } from '../shared/protocol.js';

export type RequestHandler = (request: AgentRequest) => Promise<unknown> | unknown;

export interface WebSocketFactory {
  create(url: string): WebSocket;
}

export class AgentSocket {
  private ws: WebSocket | null = null;
  private requestHandler: RequestHandler | null = null;
  private onOpenCallbacks: Array<() => void> = [];
  private onCloseCallbacks: Array<() => void> = [];
  private onErrorCallbacks: Array<(error: Error) => void> = [];
  private wsFactory: WebSocketFactory;

  /**
   * @param url - WebSocket URL to connect to (default: ws://localhost:8765)
   * @param token - Optional authentication token
   * @param wsFactory - Optional WebSocket factory for testing (defaults to global WebSocket)
   */
  constructor(
    url: string | undefined,
    token?: string,
    wsFactory?: WebSocketFactory,
  ) {
    this.wsFactory = wsFactory ?? {
      create: (url: string) => new WebSocket(url),
    };
    this.connect(url ?? 'ws://localhost:8765', token);
  }

  private async connect(url: string, token?: string): Promise<void> {
    // Get manifest version and tabs, then establish WebSocket connection
    const [version, tabs] = await Promise.all([
      this.getManifestVersion(),
      this.getTabs(),
    ]);

    this.ws = this.wsFactory.create(url);

    this.ws.onopen = () => {
      this.sendHello(version, tabs, token);
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
    return tabs.map(tab => {
      const result: { id: number; url?: string; title?: string; active: boolean } = {
        id: tab.id ?? 0,
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

  private sendHello(version: string, tabs: Array<{ id: number; url?: string; title?: string; active: boolean }>, token?: string): void {
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
    this.send(hello);
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
      if (message.type === 'request' && this.requestHandler) {
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
    this.send(response);
  }

  private sendProtocolError(request: { id: string; type: string }, message: string): void {
    this.sendResponse(request.id, {
      error: {
        code: 'PROTOCOL_ERROR',
        message,
      },
    });
  }

  private send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
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
    agentSocket = new AgentSocket('ws://localhost:8765');
  }
  return agentSocket;
}

export function createAgentSocket(url?: string, token?: string): AgentSocket {
  agentSocket = new AgentSocket(url, token);
  return agentSocket;
}