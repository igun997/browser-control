import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DeepNetworkInspector } from './deepNetworkInspector.js';
import type { AgentEvent } from '../shared/protocol.js';

// Mock chrome debugger API
function createMockDebugger() {
  return {
    attach: vi.fn().mockImplementation((target, _version, callback) => {
      if (callback) callback();
    }),
    detach: vi.fn().mockImplementation((target, callback) => {
      if (callback) callback();
    }),
    sendCommand: vi.fn().mockImplementation((target, _method, _params, callback) => {
      if (callback) callback({});
    }),
    onEvent: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  };
}

// Mock Chrome API with debugger
function mockChromeDebugger(mockDebugger: ReturnType<typeof createMockDebugger>) {
  vi.stubGlobal('chrome', {
    debugger: mockDebugger,
  });
}

describe('DeepNetworkInspector', () => {
  let emit: (event: AgentEvent) => void;
  let capturedEvents: AgentEvent[];
  let mockDebugger: ReturnType<typeof createMockDebugger>;

  beforeEach(() => {
    capturedEvents = [];
    emit = vi.fn((event: AgentEvent) => {
      capturedEvents.push(event);
    });
    mockDebugger = createMockDebugger();
    mockChromeDebugger(mockDebugger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should be constructed with emit function', () => {
      const inspector = new DeepNetworkInspector(emit);
      expect(inspector).toBeDefined();
    });

    it('should accept a chrome.debugger-like API in constructor', () => {
      const customApi = createMockDebugger();
      const inspector = new DeepNetworkInspector(emit, customApi);
      expect(inspector).toBeDefined();
    });
  });

  describe('start(tabId)', () => {
    it('should attach debugger with protocol version 1.3', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      expect(mockDebugger.attach).toHaveBeenCalledWith(
        { tabId: 42 },
        '1.3',
        expect.any(Function)
      );
    });

    it('should send Network.enable command after attaching', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      expect(mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Network.enable',
        {},
        expect.any(Function)
      );
    });

    it('should track the attached tab', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);
      expect(inspector.isAttached(42)).toBe(true);
    });

    it('should return tabId and deepNetwork:started status', async () => {
      const inspector = new DeepNetworkInspector(emit);

      const result = await inspector.start(42);

      expect(result).toEqual({ tabId: 42, deepNetwork: 'started' });
    });

    it('should handle start on multiple tabs', async () => {
      const inspector = new DeepNetworkInspector(emit);

      const result1 = await inspector.start(42);
      const result2 = await inspector.start(99);

      expect(result1).toEqual({ tabId: 42, deepNetwork: 'started' });
      expect(result2).toEqual({ tabId: 99, deepNetwork: 'started' });
    });

    it('should reject when attach fails', async () => {
      mockDebugger.attach.mockImplementation((target, _version, callback) => {
        if (callback) callback({ message: 'Target not found' });
      });

      const inspector = new DeepNetworkInspector(emit);

      await expect(inspector.start(42)).rejects.toThrow('Failed to attach debugger: Target not found');
      expect(inspector.isAttached(42)).toBe(false);
    });

    it('should reject when Network.enable fails', async () => {
      mockDebugger.sendCommand.mockImplementation((target, method, _params, callback) => {
        if (method === 'Network.enable' && callback) {
          callback({}, { message: 'Protocol not available' });
        }
      });

      const inspector = new DeepNetworkInspector(emit);

      await expect(inspector.start(42)).rejects.toThrow('Failed to enable Network: Protocol not available');
      expect(inspector.isAttached(42)).toBe(false);
    });

    it('should detach after Network.enable failure', async () => {
      mockDebugger.sendCommand.mockImplementation((target, method, _params, callback) => {
        if (method === 'Network.enable' && callback) {
          callback({}, { message: 'Protocol not available' });
        }
      });

      const inspector = new DeepNetworkInspector(emit);

      try {
        await inspector.start(42);
      } catch {
        // Expected to reject
      }

      expect(mockDebugger.detach).toHaveBeenCalledWith({ tabId: 42 }, expect.any(Function));
    });

    it('should not track tab when attach fails', async () => {
      mockDebugger.attach.mockImplementation((target, _version, callback) => {
        if (callback) callback({ message: 'Already attached to other target' });
      });

      const inspector = new DeepNetworkInspector(emit);

      try {
        await inspector.start(42);
      } catch {
        // Expected to reject
      }

      expect(inspector.isAttached(42)).toBe(false);
      expect(inspector.getAttachedTabs()).toHaveLength(0);
    });
  });

  describe('stop(tabId)', () => {
    it('should detach debugger from specified tab', async () => {
      const inspector = new DeepNetworkInspector(emit);

      // Start first to ensure we're tracking
      await inspector.start(42);
      await inspector.stop(42);

      expect(mockDebugger.detach).toHaveBeenCalledWith(
        { tabId: 42 },
        expect.any(Function)
      );
    });

    it('should untrack the tab after stopping', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);
      await inspector.stop(42);

      expect(inspector.isAttached(42)).toBe(false);
    });

    it('should return tabId and deepNetwork:stopped status', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);
      const result = await inspector.stop(42);

      expect(result).toEqual({ tabId: 42, deepNetwork: 'stopped' });
    });

    it('should handle stop for tab that was never started', async () => {
      const inspector = new DeepNetworkInspector(emit);

      const result = await inspector.stop(99);

      // Should return stopped even if not tracking
      expect(result).toEqual({ tabId: 99, deepNetwork: 'stopped' });
      expect(mockDebugger.detach).not.toHaveBeenCalled();
    });

    it('should handle stop for tabs with different IDs', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);
      await inspector.start(99);

      await inspector.stop(42);
      await inspector.stop(99);

      expect(mockDebugger.detach).toHaveBeenCalledTimes(2);
    });

    it('should keep tab tracked when detach fails', async () => {
      mockDebugger.detach.mockImplementation((target, callback) => {
        if (callback) callback({ message: 'Detach failed' });
      });

      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      await expect(inspector.stop(42)).rejects.toThrow('Failed to detach debugger: Detach failed');
      expect(inspector.isAttached(42)).toBe(true);
    });

    it('should keep tab tracked when detach callback has lastError', async () => {
      mockDebugger.detach.mockImplementation((target, callback) => {
        if (callback) callback({ message: 'Cannot detach - debugger active' });
      });

      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      await expect(inspector.stop(42)).rejects.toThrow('Failed to detach debugger: Cannot detach - debugger active');
      expect(inspector.isAttached(42)).toBe(true);
    });

    it('should succeed on stop when detach succeeds', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      const result = await inspector.stop(42);

      expect(result).toEqual({ tabId: 42, deepNetwork: 'stopped' });
      expect(inspector.isAttached(42)).toBe(false);
    });
  });

  describe('getResponseBody(tabId, requestId)', () => {
    it('should send Network.getResponseBody command with requestId', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);
      await inspector.getResponseBody(42, 'request-123');

      expect(mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 42 },
        'Network.getResponseBody',
        { requestId: 'request-123' },
        expect.any(Function)
      );
    });

    it('should return the result from getResponseBody', async () => {
      mockDebugger.sendCommand.mockImplementation(
        (_target, _method, _params, callback) => {
          callback({ body: 'response content', base64Encoded: false });
        }
      );

      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);
      const result = await inspector.getResponseBody(42, 'request-456');

      expect(result).toEqual({ body: 'response content', base64Encoded: false });
    });

    it('should throw when requestId is not a string', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      await expect(
        inspector.getResponseBody(42, 123 as unknown as string)
      ).rejects.toThrow('requestId must be a non-empty string');
    });

    it('should throw when requestId is empty string', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      await expect(
        inspector.getResponseBody(42, '')
      ).rejects.toThrow('requestId must be a non-empty string');
    });

    it('should work on a different tab than the one attached', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);
      await inspector.getResponseBody(99, 'request-789');

      expect(mockDebugger.sendCommand).toHaveBeenCalledWith(
        { tabId: 99 },
        'Network.getResponseBody',
        { requestId: 'request-789' },
        expect.any(Function)
      );
    });

    it('should reject when command fails with lastError', async () => {
      // Override sendCommand to return error only for Network.getResponseBody
      mockDebugger.sendCommand.mockImplementation(
        (_target, method, _params, callback) => {
          if (method === 'Network.getResponseBody' && callback) {
            callback(null, { message: 'No resource with given identifier' });
          }
          // Default for other methods (like Network.enable)
          else if (callback) {
            callback({});
          }
        }
      );

      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      await expect(inspector.getResponseBody(42, 'unknown-request'))
        .rejects.toThrow('Failed to get response body: No resource with given identifier');
    });
  });

  describe('handleEvent(source, method, params)', () => {
    it('should emit event when Network.requestWillBeSent is received for attached tab', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', {
        requestId: 'req-1',
        request: { url: 'https://example.com' },
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]).toEqual({
        type: 'event',
        event: 'cdp:Network.requestWillBeSent',
        tabId: 42,
        payload: {
          requestId: 'req-1',
          request: { url: 'https://example.com' },
        },
      });
    });

    it('should emit event for Network.responseReceived', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Network.responseReceived', {
        requestId: 'req-2',
        response: { status: 200 },
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]).toEqual({
        type: 'event',
        event: 'cdp:Network.responseReceived',
        tabId: 42,
        payload: { requestId: 'req-2', response: { status: 200 } },
      });
    });

    it('should emit event for Network.dataReceived', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Network.dataReceived', {
        requestId: 'req-3',
        dataLength: 1024,
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]).toEqual({
        type: 'event',
        event: 'cdp:Network.dataReceived',
        tabId: 42,
        payload: { requestId: 'req-3', dataLength: 1024 },
      });
    });

    it('should emit event for Network.loadingFinished', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Network.loadingFinished', {
        requestId: 'req-4',
        timestamp: 1234567890,
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]).toEqual({
        type: 'event',
        event: 'cdp:Network.loadingFinished',
        tabId: 42,
        payload: { requestId: 'req-4', timestamp: 1234567890 },
      });
    });

    it('should not emit event for non-Network methods', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Page.loadEventFired', { timestamp: 123 });

      expect(capturedEvents).toHaveLength(0);
    });

    it('should not emit event when source has no tabId', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({}, 'Network.requestWillBeSent', { requestId: 'req-1' });

      expect(capturedEvents).toHaveLength(0);
    });

    it('should not emit event for unattached tab', async () => {
      const inspector = new DeepNetworkInspector(emit);

      // Tab 42 is NOT attached
      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', {
        requestId: 'req-1',
        request: { url: 'https://example.com' },
      });

      expect(capturedEvents).toHaveLength(0);
    });

    it('should emit event only for attached tab', async () => {
      const inspector = new DeepNetworkInspector(emit);

      // Start monitoring tab 42
      await inspector.start(42);

      // Tab 42 is attached, should emit
      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', {
        requestId: 'req-1',
        request: { url: 'https://example.com' },
      });

      // Tab 99 is not attached, should not emit
      inspector.handleEvent({ tabId: 99 }, 'Network.requestWillBeSent', {
        requestId: 'req-2',
        request: { url: 'https://example.com/other' },
      });

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]!.tabId).toBe(42);
    });

    it('should handle null params', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', null);

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]).toEqual({
        type: 'event',
        event: 'cdp:Network.requestWillBeSent',
        tabId: 42,
        payload: {},
      });
    });

    it('should handle undefined params', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', undefined);

      expect(capturedEvents).toHaveLength(1);
      expect(capturedEvents[0]).toEqual({
        type: 'event',
        event: 'cdp:Network.requestWillBeSent',
        tabId: 42,
        payload: {},
      });
    });

    it('should handle params with extra properties', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', {
        requestId: 'req-5',
        type: 'XHR',
        timestamp: 1234567890,
        extra: 'data',
      });

      expect(capturedEvents[0]!.payload).toEqual({
        requestId: 'req-5',
        type: 'XHR',
        timestamp: 1234567890,
        extra: 'data',
      });
    });
  });

  describe('end-to-end scenario', () => {
    it('should handle full network request lifecycle', async () => {
      const inspector = new DeepNetworkInspector(emit);

      // Start monitoring
      await inspector.start(42);

      // Simulate CDP events
      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', {
        requestId: 'lifecycle-1',
        request: { method: 'GET', url: 'https://api.example.com/data' },
      });

      inspector.handleEvent({ tabId: 42 }, 'Network.responseReceived', {
        requestId: 'lifecycle-1',
        response: { status: 200, headers: { 'content-type': 'application/json' } },
      });

      // Get response body
      mockDebugger.sendCommand.mockImplementation(
        (_target, _method, _params, callback) => {
          callback({ body: '{"data": "value"}', base64Encoded: false });
        }
      );

      const body = await inspector.getResponseBody(42, 'lifecycle-1');
      expect(body).toEqual({ body: '{"data": "value"}', base64Encoded: false });

      inspector.handleEvent({ tabId: 42 }, 'Network.loadingFinished', {
        requestId: 'lifecycle-1',
        encodedDataLength: 1024,
      });

      // Stop monitoring
      await inspector.stop(42);

      // Verify all events were captured
      expect(capturedEvents).toHaveLength(3);
      expect(capturedEvents[0]!.event).toBe('cdp:Network.requestWillBeSent');
      expect(capturedEvents[1]!.event).toBe('cdp:Network.responseReceived');
      expect(capturedEvents[2]!.event).toBe('cdp:Network.loadingFinished');
    });

    it('should handle multiple concurrent requests', async () => {
      const inspector = new DeepNetworkInspector(emit);

      await inspector.start(42);

      // Simulate multiple requests
      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', {
        requestId: 'req-a',
        request: { url: 'https://example.com/a' },
      });

      inspector.handleEvent({ tabId: 42 }, 'Network.requestWillBeSent', {
        requestId: 'req-b',
        request: { url: 'https://example.com/b' },
      });

      expect(capturedEvents).toHaveLength(2);
      expect(capturedEvents[0]!.payload.requestId).toBe('req-a');
      expect(capturedEvents[1]!.payload.requestId).toBe('req-b');
    });
  });
});