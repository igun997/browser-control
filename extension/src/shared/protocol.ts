export type TabTarget = 'active' | number;

export interface AgentRequest {
  id: string;
  type: 'request';
  method: string;
  params: Record<string, unknown>;
}

export interface AgentResponse {
  id: string;
  type: 'response';
  result?: unknown;
  error?: ProtocolError;
}

export interface AgentEvent {
  type: 'event';
  event: string;
  tabId?: number | undefined;
  windowId?: number | undefined;
  payload: Record<string, unknown>;
}

export interface ProtocolError {
  code: string;
  message: string;
  details?: unknown;
}

export interface HelloMessage {
  type: 'hello';
  version: string;
  permissions: string[];
  tabs: Array<{ id: number; url?: string; title?: string; active: boolean }>;
  token?: string;
}

export interface HelloAckMessage {
  type: 'hello_ack';
  sessionId: string;
  config?: {
    network?: {
      enabled?: boolean;
      urlAllowlist?: string[];
      urlBlocklist?: string[];
    };
    redactHeaders?: string[];
    bodyLimitBytes?: number;
  };
}

export function parseAgentMessage(value: unknown): AgentRequest | HelloAckMessage {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid message format');
  }

  const msg = value as Record<string, unknown>;

  // Check if it's a hello_ack message
  if (msg.type === 'hello_ack') {
    if (typeof msg.sessionId !== 'string') {
      throw new Error('Invalid hello_ack: missing sessionId');
    }
    return msg as unknown as HelloAckMessage;
  }

  // Validate request object structure
  if (typeof msg.id !== 'string') {
    throw new Error('Missing id');
  }
  if (msg.type !== 'request') {
    throw new Error('Invalid message type');
  }
  if (typeof msg.method !== 'string') {
    throw new Error('Missing method');
  }
  if (typeof msg.params !== 'object' || msg.params === null || Array.isArray(msg.params)) {
    throw new Error('Invalid params');
  }

  return msg as unknown as AgentRequest;
}

export function resolveTabTarget(target: TabTarget | unknown, activeTabId: number | undefined): number {
  if (target === 'active') {
    if (activeTabId === undefined) {
      throw new Error('No active tab available');
    }
    return activeTabId;
  }
  if (typeof target === 'number' && Number.isInteger(target) && target > 0) {
    return target;
  }
  throw new Error('Invalid tab target');
}

export function toProtocolError(error: unknown): ProtocolError {
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.code === 'string' && typeof e.message === 'string') {
      return { code: e.code, message: e.message, details: e.details };
    }
  }
  if (error instanceof Error) {
    return { code: 'INTERNAL_ERROR', message: error.message };
  }
  return { code: 'UNKNOWN_ERROR', message: String(error) };
}