import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentSocket, WebSocketFactory } from './wsClient.js';

// Create a fresh mock WebSocket for each test
function createMockWs() {
  const sentData: string[] = [];
  let readyState = 1; // OPEN
  let _onopen: ((event: Event) => void) | null = null;
  let _onclose: ((event: CloseEvent) => void) | null = null;
  let _onmessage: ((event: MessageEvent) => void) | null = null;
  let _onerror: ((event: Event) => void) | null = null;

  return {
    get readyState() { return readyState; },
    get url() { return 'ws://localhost:8765'; },
    set onopen(fn: ((event: Event) => void) | null) { _onopen = fn; },
    set onclose(fn: ((event: CloseEvent) => void) | null) { _onclose = fn; },
    set onmessage(fn: ((event: MessageEvent) => void) | null) { _onmessage = fn; },
    set onerror(fn: ((event: Event) => void) | null) { _onerror = fn; },
    sentData,
    send(data: string) { sentData.push(data); },
    close() {
      readyState = 3;
      _onclose?.(new CloseEvent('close', { code: 1000 }));
    },
    _simulateOpen() {
      _onopen?.(new Event('open'));
    },
    _simulateMessage(data: unknown) {
      const event = new MessageEvent('message', {
        data: typeof data === 'string' ? data : JSON.stringify(data),
      });
      _onmessage?.(event);
    },
    _simulateClose() {
      _onclose?.(new CloseEvent('close', { code: 1000 }));
    },
  };
}

// Create a mock WebSocket that starts in CLOSED state
function createClosedMockWs() {
  let _onopen: ((event: Event) => void) | null = null;

  return {
    get readyState() { return WebSocket.CLOSED; },
    get url() { return 'ws://localhost:8765'; },
    set onopen(fn: ((event: Event) => void) | null) { _onopen = fn; },
    set onclose(_: ((event: CloseEvent) => void) | null) { },
    set onmessage(_: ((event: MessageEvent) => void) | null) { },
    set onerror(_: ((event: Event) => void) | null) { },
    sentData: [] as string[],
    send(_: string) { /* no-op to simulate send failure */ },
    close() { },
    _simulateOpen() { _onopen?.(new Event('open')); },
  };
}

describe('AgentSocket', () => {
  beforeEach(() => {
    // Mock chrome runtime
    vi.stubGlobal('chrome', {
      runtime: {
        getManifest: () => ({
          version: '0.1.0',
          permissions: ['storage', 'tabs', 'scripting', 'activeTab', 'webRequest', 'debugger'],
        }),
      },
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, url: 'https://example.com', title: 'Example', active: true },
          { id: 2, url: 'https://test.com', title: 'Test', active: false },
        ]),
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should not start connection in constructor', () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      new AgentSocket({ url: 'ws://localhost:9000', wsFactory: factory });
      
      // Factory should not be called yet
      expect(factory.create).not.toHaveBeenCalled();
    });

    it('should use default localhost:8765 URL when no URL provided', async () => {
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(createMockWs()),
      };
      
      const socket = new AgentSocket({ wsFactory: factory });
      await socket.connect();
      
      expect(factory.create).toHaveBeenCalledWith('ws://localhost:8765');
    });

    it('should accept options object with url and token', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({
        url: 'ws://localhost:9000',
        token: 'test-token',
        wsFactory: factory,
      });
      await socket.connect();
      
      expect(factory.create).toHaveBeenCalledWith('ws://localhost:9000');
    });
  });

  describe('connect()', () => {
    it('should create WebSocket with provided URL on connect', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:9000', wsFactory: factory });
      await socket.connect();
      
      expect(factory.create).toHaveBeenCalledWith('ws://localhost:9000');
    });

    it('should fire onOpen callback when connection opens', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const onOpen = vi.fn();
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      socket.onOpen(onOpen);
      await socket.connect();

      // Simulate the WebSocket opening
      mockWs._simulateOpen();

      expect(onOpen).toHaveBeenCalled();
    });

    it('should be idempotent - multiple connects should not create multiple sockets', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      await socket.connect();
      await socket.connect();
      
      expect(factory.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('hello message', () => {
    it('should send hello message on open with version, permissions, tabs, and token', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();

      // Trigger connection open
      mockWs._simulateOpen();

      expect(mockWs.sentData.length).toBe(1);
      const helloMessage = JSON.parse(mockWs.sentData[0]!);
      expect(helloMessage.type).toBe('hello');
      expect(helloMessage.version).toBe('0.1.0');
      expect(helloMessage.permissions).toEqual(['storage', 'tabs', 'scripting', 'activeTab', 'webRequest', 'debugger']);
      expect(helloMessage.tabs).toEqual([
        { id: 1, url: 'https://example.com', title: 'Example', active: true },
        { id: 2, url: 'https://test.com', title: 'Test', active: false },
      ]);
      expect(helloMessage.token).toBeUndefined();
    });

    it('should include token when provided', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', token: 'my-secret-token', wsFactory: factory });
      await socket.connect();

      mockWs._simulateOpen();

      const helloMessage = JSON.parse(mockWs.sentData[0]!);
      expect(helloMessage.token).toBe('my-secret-token');
    });

    it('should filter out tabs with undefined id', async () => {
      // Override the mock for this specific test
      (chrome.tabs.query as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 1, url: 'https://example.com', title: 'Example', active: true },
        { id: undefined, url: 'https://undefined-id.com', title: 'No ID', active: false },
        { id: 2, url: 'https://test.com', title: 'Test', active: false },
        { id: undefined, url: 'https://another-undefined.com', title: 'Also No ID', active: true },
      ]);

      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();

      mockWs._simulateOpen();

      const helloMessage = JSON.parse(mockWs.sentData[0]!);
      expect(helloMessage.tabs).toEqual([
        { id: 1, url: 'https://example.com', title: 'Example', active: true },
        { id: 2, url: 'https://test.com', title: 'Test', active: false },
      ]);
      expect(helloMessage.tabs.length).toBe(2);
    });

    it('should report error via onError when hello fails to send', async () => {
      const mockWs = createClosedMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const onError = vi.fn();
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      socket.onError(onError);
      await socket.connect();

      // Trigger connection open - hello will fail to send because state is CLOSED
      mockWs._simulateOpen();

      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        message: 'Failed to send hello message',
      }));
    });
  });

  describe('message handling', () => {
    it('should ignore hello_ack messages', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const handler = vi.fn();
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      socket.onRequest(handler);

      mockWs._simulateOpen();

      // Send hello_ack
      mockWs._simulateMessage({
        type: 'hello_ack',
        sessionId: 'session-123',
      });

      // Handler should not be called for hello_ack
      expect(handler).not.toHaveBeenCalled();
    });

    it('should dispatch request messages to registered handler', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      socket.onRequest(handler);

      mockWs._simulateOpen();

      // Send request message
      mockWs._simulateMessage({
        id: 'req-1',
        type: 'request',
        method: 'testMethod',
        params: { foo: 'bar' },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith({
        id: 'req-1',
        type: 'request',
        method: 'testMethod',
        params: { foo: 'bar' },
      });
    });

    it('should send response with result when handler succeeds', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const handler = vi.fn().mockResolvedValue({ success: true });
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      socket.onRequest(handler);

      mockWs._simulateOpen();

      mockWs._simulateMessage({
        id: 'req-1',
        type: 'request',
        method: 'testMethod',
        params: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentMessages = mockWs.sentData.slice(1).map(d => JSON.parse(d)); // Skip hello
      const response = sentMessages.find(m => m.type === 'response');
      expect(response).toBeDefined();
      expect(response.id).toBe('req-1');
      expect(response.result).toEqual({ success: true });
      expect(response.error).toBeUndefined();
    });

    it('should send response with protocol error when handler throws', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const handler = vi.fn().mockRejectedValue(new Error('Test error'));
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      socket.onRequest(handler);

      mockWs._simulateOpen();

      mockWs._simulateMessage({
        id: 'req-2',
        type: 'request',
        method: 'failingMethod',
        params: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentMessages = mockWs.sentData.slice(1).map(d => JSON.parse(d));
      const response = sentMessages.find(m => m.type === 'response');
      expect(response).toBeDefined();
      expect(response.id).toBe('req-2');
      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({ code: 'INTERNAL_ERROR', message: 'Test error' });
    });

    it('should send response with protocol error for non-Error exceptions', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const handler = vi.fn().mockRejectedValue('string error');
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      socket.onRequest(handler);

      mockWs._simulateOpen();

      mockWs._simulateMessage({
        id: 'req-3',
        type: 'request',
        method: 'failingMethod',
        params: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentMessages = mockWs.sentData.slice(1).map(d => JSON.parse(d));
      const response = sentMessages.find(m => m.type === 'response');
      expect(response).toBeDefined();
      expect(response.id).toBe('req-3');
      expect(response.error).toEqual({ code: 'UNKNOWN_ERROR', message: 'string error' });
    });

    it('should send NO_REQUEST_HANDLER error when no handler registered', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      // Note: NOT registering a handler

      mockWs._simulateOpen();

      // Send request message before handler is registered
      mockWs._simulateMessage({
        id: 'req-no-handler',
        type: 'request',
        method: 'testMethod',
        params: { foo: 'bar' },
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentMessages = mockWs.sentData.slice(1).map(d => JSON.parse(d));
      const response = sentMessages.find(m => m.type === 'response');
      expect(response).toBeDefined();
      expect(response.id).toBe('req-no-handler');
      expect(response.result).toBeUndefined();
      expect(response.error).toEqual({
        code: 'NO_REQUEST_HANDLER',
        message: 'No request handler registered',
      });
    });
  });

  describe('protocol error handling', () => {
    it('should send protocol error for malformed messages', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();

      mockWs._simulateOpen();

      // Send malformed message (missing id)
      mockWs._simulateMessage({
        type: 'request',
        method: 'test',
        params: {},
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentMessages = mockWs.sentData.slice(1).map(d => JSON.parse(d));
      const response = sentMessages.find(m => m.type === 'response');
      expect(response).toBeDefined();
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe('PROTOCOL_ERROR');
    });

    it('should send protocol error for non-object messages', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();

      mockWs._simulateOpen();

      // Send string message (should be rejected by parseAgentMessage)
      mockWs._simulateMessage('not an object');

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentMessages = mockWs.sentData.slice(1).map(d => JSON.parse(d));
      const response = sentMessages.find(m => m.type === 'response');
      expect(response).toBeDefined();
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe('PROTOCOL_ERROR');
    });

    it('should send protocol error for invalid JSON', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();

      mockWs._simulateOpen();

      mockWs._simulateMessage('invalid json {');

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentMessages = mockWs.sentData.slice(1).map(d => JSON.parse(d));
      const response = sentMessages.find(m => m.type === 'response');
      expect(response).toBeDefined();
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe('PROTOCOL_ERROR');
      expect(response.error.message).toBe('Invalid JSON format');
    });
  });

  describe('sendEvent', () => {
    it('should send event with top-level tabId when provided', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      mockWs._simulateOpen();

      const payload = { url: 'https://example.com', status: 'loading' };
      socket.sendEvent('tab:updated', payload, 123);

      expect(mockWs.sentData.length).toBe(2); // hello + event
      const sentMessage = JSON.parse(mockWs.sentData[1]!);
      expect(sentMessage.type).toBe('event');
      expect(sentMessage.event).toBe('tab:updated');
      expect(sentMessage.tabId).toBe(123);
      expect(sentMessage.payload).toEqual(payload);
    });

    it('should send event without top-level tabId when not provided', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      mockWs._simulateOpen();

      const payload = { url: 'https://example.com' };
      socket.sendEvent('tab:updated', payload);

      expect(mockWs.sentData.length).toBe(2);
      const sentMessage = JSON.parse(mockWs.sentData[1]!);
      expect(sentMessage.type).toBe('event');
      expect(sentMessage.event).toBe('tab:updated');
      expect(sentMessage.tabId).toBeUndefined();
      expect(sentMessage.payload).toEqual(payload);
    });

    it('should send event without top-level tabId when tabId is undefined', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      mockWs._simulateOpen();

      const payload = { someData: true };
      socket.sendEvent('some:event', payload, undefined);

      expect(mockWs.sentData.length).toBe(2);
      const sentMessage = JSON.parse(mockWs.sentData[1]!);
      expect(sentMessage.type).toBe('event');
      expect(sentMessage.tabId).toBeUndefined();
    });

    it('should return true on successful send', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      mockWs._simulateOpen();

      const result = socket.sendEvent('test:event', { data: 'test' }, 42);
      expect(result).toBe(true);
    });

    it('should return false when socket is not connected', async () => {
      const mockWs = createClosedMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      // Note: NOT connecting

      const result = socket.sendEvent('test:event', { data: 'test' });
      expect(result).toBe(false);
    });
  });

  describe('disconnect', () => {
    it('should close the connection', async () => {
      const mockWs = createMockWs();
      const factory: WebSocketFactory = {
        create: vi.fn().mockReturnValue(mockWs as unknown as WebSocket),
      };
      const onClose = vi.fn();
      
      const socket = new AgentSocket({ url: 'ws://localhost:8765', wsFactory: factory });
      await socket.connect();
      socket.onClose(onClose);

      mockWs._simulateOpen();

      socket.disconnect();
      expect(onClose).toHaveBeenCalled();
      expect(mockWs.readyState).toBe(3); // CLOSED
    });
  });
});