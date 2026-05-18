import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkInspector } from './networkInspector.js';

type EmitFn = (event: string, payload: Record<string, unknown>) => void;

// Mock Chrome API
function mockChromeWebRequest(): void {
  vi.stubGlobal('chrome', {
    webRequest: {
      onBeforeRequest: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onBeforeSendHeaders: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onHeadersReceived: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onCompleted: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onErrorOccurred: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
}

describe('NetworkInspector', () => {
  let emit: EmitFn;
  let capturedEvents: Array<{ event: string; payload: Record<string, unknown> }>;

  beforeEach(() => {
    capturedEvents = [];
    emit = vi.fn((event: string, payload: Record<string, unknown>) => {
      capturedEvents.push({ event, payload });
    });
    mockChromeWebRequest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should accept emit function in constructor', () => {
      const inspector = new NetworkInspector(emit);
      expect(inspector).toBeDefined();
    });
  });

  describe('attach()', () => {
    it('should register onBeforeRequest listener for all_urls', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      expect(chrome.webRequest.onBeforeRequest.addListener).toHaveBeenCalledWith(
        expect.any(Function),
        { urls: ['<all_urls>'] },
        expect.arrayContaining(['requestBody'])
      );
    });

    it('should register onBeforeSendHeaders listener for all_urls with requestHeaders', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      expect(chrome.webRequest.onBeforeSendHeaders.addListener).toHaveBeenCalledWith(
        expect.any(Function),
        { urls: ['<all_urls>'], types: expect.any(Array), tabId: -1 },
        expect.arrayContaining(['requestHeaders'])
      );
    });

    it('should register onHeadersReceived listener for all_urls with responseHeaders', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      expect(chrome.webRequest.onHeadersReceived.addListener).toHaveBeenCalledWith(
        expect.any(Function),
        { urls: ['<all_urls>'] },
        expect.arrayContaining(['responseHeaders'])
      );
    });

    it('should register onCompleted listener for all_urls', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      expect(chrome.webRequest.onCompleted.addListener).toHaveBeenCalledWith(
        expect.any(Function),
        { urls: ['<all_urls>'] },
        expect.any(Array)
      );
    });

    it('should register onErrorOccurred listener for all_urls', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      expect(chrome.webRequest.onErrorOccurred.addListener).toHaveBeenCalledWith(
        expect.any(Function),
        { urls: ['<all_urls>'] },
        expect.any(Array)
      );
    });

    it('should be idempotent - multiple attaches should not register duplicate listeners', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();
      inspector.attach();

      // Should only be called 5 times total (one per event type)
      expect(chrome.webRequest.onBeforeRequest.addListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('request correlation', () => {
    it('should correlate request data across lifecycle events using requestId', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      // Get the registered listeners
      const onBeforeRequestListener = (chrome.webRequest.onBeforeRequest.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const onHeadersReceivedListener = (chrome.webRequest.onHeadersReceived.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const onCompletedListener = (chrome.webRequest.onCompleted.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      const requestId = '12345';

      // Simulate request start
      onBeforeRequestListener({
        requestId,
        url: 'https://example.com/api',
        method: 'GET',
        frameId: 1,
        parentFrameId: -1,
        type: 'xmlhttprequest' as chrome.webRequest.ResourceType,
        timeStamp: Date.now(),
      });

      // Simulate headers received
      onHeadersReceivedListener({
        requestId,
        url: 'https://example.com/api',
        statusLine: 'HTTP/1.1 200 OK',
        statusCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
        ],
        timeStamp: Date.now(),
      });

      // Simulate request complete
      onCompletedListener({
        requestId,
        url: 'https://example.com/api',
        statusCode: 200,
        timeStamp: Date.now(),
      });

      // Verify all events have the same requestId
      expect(capturedEvents[0]!.payload.requestId).toBe(requestId);
      expect(capturedEvents[1]!.payload.requestId).toBe(requestId);
      expect(capturedEvents[2]!.payload.requestId).toBe(requestId);
    });
  });

  describe('network:request event', () => {
    it('should emit network:request on before request', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onBeforeRequest.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '123',
        url: 'https://example.com/api',
        method: 'POST',
        frameId: 5,
        parentFrameId: -1,
        type: 'xmlhttprequest' as chrome.webRequest.ResourceType,
        timeStamp: Date.now(),
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]!.event).toBe('network:request');
      expect(capturedEvents[0]!.payload.requestId).toBe('123');
      expect(capturedEvents[0]!.payload.url).toBe('https://example.com/api');
      expect(capturedEvents[0]!.payload.method).toBe('POST');
      expect(capturedEvents[0]!.payload.type).toBe('xmlhttprequest');
      expect(capturedEvents[0]!.payload.frameId).toBe(5);
    });

    it('should include timestamp in request payload', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onBeforeRequest.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      const timestamp = Date.now();

      listener({
        requestId: '456',
        url: 'https://example.com/test',
        method: 'GET',
        frameId: 1,
        parentFrameId: -1,
        type: 'main_frame' as chrome.webRequest.ResourceType,
        timeStamp: timestamp,
      });

      expect(capturedEvents[0]!.payload.timestamp).toBe(timestamp);
    });
  });

  describe('network:response event', () => {
    it('should emit network:response on headers received', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onHeadersReceived.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '789',
        url: 'https://example.com/page',
        statusLine: 'HTTP/1.1 200 OK',
        statusCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'text/html' },
        ],
        timeStamp: Date.now(),
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]!.event).toBe('network:response');
      expect(capturedEvents[0]!.payload.requestId).toBe('789');
      expect(capturedEvents[0]!.payload.status).toBe(200);
      expect(capturedEvents[0]!.payload.headers).toEqual([
        { name: 'Content-Type', value: 'text/html' },
      ]);
    });
  });

  describe('network:complete event', () => {
    it('should emit network:complete on completed', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onCompleted.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '101',
        url: 'https://example.com/resource',
        statusCode: 304,
        timeStamp: Date.now(),
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]!.event).toBe('network:complete');
      expect(capturedEvents[0]!.payload.requestId).toBe('101');
      expect(capturedEvents[0]!.payload.status).toBe(304);
    });
  });

  describe('network:error event', () => {
    it('should emit network:error on error', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onErrorOccurred.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '202',
        url: 'https://example.com/failing',
        error: 'net::ERR_CONNECTION_REFUSED',
        timeStamp: Date.now(),
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]!.event).toBe('network:error');
      expect(capturedEvents[0]!.payload.requestId).toBe('202');
      expect(capturedEvents[0]!.payload.error).toBe('net::ERR_CONNECTION_REFUSED');
    });
  });

  describe('redactHeaders', () => {
    it('should redact Authorization header values', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onHeadersReceived.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '301',
        url: 'https://example.com/api',
        statusLine: 'HTTP/1.1 200 OK',
        statusCode: 200,
        responseHeaders: [
          { name: 'Authorization', value: 'Bearer secret-token-123' },
        ],
        timeStamp: Date.now(),
      });

      expect(capturedEvents[0]!.payload.headers).toEqual([
        { name: 'Authorization', value: '<redacted>' },
      ]);
    });

    it('should redact Cookie header values case-insensitively', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onHeadersReceived.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '302',
        url: 'https://example.com/api',
        statusLine: 'HTTP/1.1 200 OK',
        statusCode: 200,
        responseHeaders: [
          { name: 'cookie', value: 'session=abc123; user=john' },
          { name: 'COOKIE', value: 'another=value' },
        ],
        timeStamp: Date.now(),
      });

      expect(capturedEvents[0]!.payload.headers).toEqual([
        { name: 'cookie', value: '<redacted>' },
        { name: 'COOKIE', value: '<redacted>' },
      ]);
    });

    it('should redact Set-Cookie header values', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onHeadersReceived.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '303',
        url: 'https://example.com/api',
        statusLine: 'HTTP/1.1 200 OK',
        statusCode: 200,
        responseHeaders: [
          { name: 'Set-Cookie', value: 'session=xyz789; HttpOnly' },
        ],
        timeStamp: Date.now(),
      });

      expect(capturedEvents[0]!.payload.headers).toEqual([
        { name: 'Set-Cookie', value: '<redacted>' },
      ]);
    });

    it('should redact authorization header in mixed case', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onHeadersReceived.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '304',
        url: 'https://example.com/api',
        statusLine: 'HTTP/1.1 200 OK',
        statusCode: 200,
        responseHeaders: [
          { name: 'authorization', value: 'Basic dXNlcjpwYXNz' },
        ],
        timeStamp: Date.now(),
      });

      expect(capturedEvents[0]!.payload.headers).toEqual([
        { name: 'authorization', value: '<redacted>' },
      ]);
    });

    it('should not redact other headers', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();

      const listener = (chrome.webRequest.onHeadersReceived.addListener as ReturnType<typeof vi.fn>).mock.calls[0]![0];

      listener({
        requestId: '305',
        url: 'https://example.com/api',
        statusLine: 'HTTP/1.1 200 OK',
        statusCode: 200,
        responseHeaders: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'X-Custom-Header', value: 'some-value' },
        ],
        timeStamp: Date.now(),
      });

      expect(capturedEvents[0]!.payload.headers).toEqual([
        { name: 'Content-Type', value: 'application/json' },
        { name: 'X-Custom-Header', value: 'some-value' },
      ]);
    });
  });

  describe('detach()', () => {
    it('should remove all registered listeners when detached', () => {
      const inspector = new NetworkInspector(emit);
      inspector.attach();
      inspector.detach();

      expect(chrome.webRequest.onBeforeRequest.removeListener).toHaveBeenCalled();
      expect(chrome.webRequest.onBeforeSendHeaders.removeListener).toHaveBeenCalled();
      expect(chrome.webRequest.onHeadersReceived.removeListener).toHaveBeenCalled();
      expect(chrome.webRequest.onCompleted.removeListener).toHaveBeenCalled();
      expect(chrome.webRequest.onErrorOccurred.removeListener).toHaveBeenCalled();
    });
  });
});