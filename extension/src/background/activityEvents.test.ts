import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AgentEvent } from '../shared/protocol.js';

// Helper to create a minimal valid Tab object
function createMockTab(overrides: Partial<chrome.tabs.Tab> = {}): chrome.tabs.Tab {
  return {
    id: 1,
    index: 0,
    windowId: 1,
    selected: false,
    pinned: false,
    highlighted: false,
    active: true,
    incognito: false,
    discarded: false,
    autoDiscardable: false,
    groupId: 0,
    frozen: false,
    ...overrides,
  };
}

// Mock chrome API for tests
function setupChromeMocks() {
  const onUpdatedCallbacks: Array<(tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void> = [];
  const onActivatedCallbacks: Array<(activeInfo: chrome.tabs.OnActivatedInfo) => void> = [];
  const onMessageCallbacks: Array<(message: unknown, sender: chrome.runtime.MessageSender) => void> = [];

  vi.stubGlobal('chrome', {
    tabs: {
      onUpdated: {
        addListener: vi.fn((callback: typeof onUpdatedCallbacks[number]) => {
          onUpdatedCallbacks.push(callback);
        }),
        removeListener: vi.fn(),
        _getCallbacks: () => onUpdatedCallbacks,
      },
      onActivated: {
        addListener: vi.fn((callback: typeof onActivatedCallbacks[number]) => {
          onActivatedCallbacks.push(callback);
        }),
        removeListener: vi.fn(),
        _getCallbacks: () => onActivatedCallbacks,
      },
      query: vi.fn().mockResolvedValue([
        { id: 1, url: 'https://example.com', title: 'Example', active: true, windowId: 1 },
        { id: 2, url: 'https://test.com', title: 'Test', active: false, windowId: 1 },
      ]),
    },
    runtime: {
      onMessage: {
        addListener: vi.fn((callback: typeof onMessageCallbacks[number]) => {
          onMessageCallbacks.push(callback);
        }),
        removeListener: vi.fn(),
        _getCallbacks: () => onMessageCallbacks,
      },
    },
  });

  return { onUpdatedCallbacks, onActivatedCallbacks, onMessageCallbacks };
}

// Import the module to test
import { ActivityEvents } from './activityEvents.js';

describe('ActivityEvents', () => {
  let emit: (event: AgentEvent) => void;
  let emitSpy: ReturnType<typeof vi.fn>;
  let activityEvents: ActivityEvents;
  let callbacks: {
    onUpdatedCallbacks: Array<(tabId: number, changeInfo: chrome.tabs.OnUpdatedInfo, tab: chrome.tabs.Tab) => void>;
    onActivatedCallbacks: Array<(activeInfo: chrome.tabs.OnActivatedInfo) => void>;
    onMessageCallbacks: Array<(message: unknown, sender: chrome.runtime.MessageSender) => void>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    emitSpy = vi.fn().mockImplementation(() => {});
    emit = emitSpy as (event: AgentEvent) => void;
    callbacks = setupChromeMocks();
    activityEvents = new ActivityEvents(emit);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should store the emit function', () => {
      expect(activityEvents).toBeDefined();
    });
  });

  describe('attach()', () => {
    it('should register chrome.tabs.onUpdated listener', () => {
      activityEvents.attach();
      expect(chrome.tabs.onUpdated.addListener).toHaveBeenCalled();
    });

    it('should register chrome.tabs.onActivated listener', () => {
      activityEvents.attach();
      expect(chrome.tabs.onActivated.addListener).toHaveBeenCalled();
    });

    it('should register chrome.runtime.onMessage listener', () => {
      activityEvents.attach();
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    });

    it('should be idempotent - multiple attaches should not register multiple listeners', () => {
      activityEvents.attach();
      activityEvents.attach();
      activityEvents.attach();
      // Each attach should only call addListener once per event type
      expect((chrome.tabs.onUpdated.addListener as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
      expect((chrome.tabs.onActivated.addListener as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
      expect((chrome.runtime.onMessage.addListener as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
    });
  });

  describe('onTabUpdated', () => {
    it('should emit tab:updated event with tabId, url, status, and title', () => {
      const tabId = 42;
      const changeInfo: chrome.tabs.OnUpdatedInfo = {
        url: 'https://newpage.com',
        status: 'loading',
      };
      const tab = createMockTab({
        id: tabId,
        title: 'New Page Title',
        url: 'https://newpage.com',
        active: false,
      });

      activityEvents.onTabUpdated(tabId, changeInfo, tab);

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'tab:updated',
        tabId,
        payload: {
          url: 'https://newpage.com',
          status: 'loading',
          title: 'New Page Title',
        },
      } satisfies AgentEvent);
    });

    it('should include undefined for missing changeInfo properties', () => {
      const tabId = 42;
      const changeInfo: chrome.tabs.OnUpdatedInfo = {};
      const tab = createMockTab({
        id: tabId,
        title: 'Test Tab',
        active: true,
      });

      activityEvents.onTabUpdated(tabId, changeInfo, tab);

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'tab:updated',
        tabId,
        payload: {
          url: undefined,
          status: undefined,
          title: 'Test Tab',
        },
      } satisfies AgentEvent);
    });

    it('should handle missing tab title gracefully', () => {
      const tabId = 42;
      const changeInfo: chrome.tabs.OnUpdatedInfo = { url: 'https://example.com', status: 'complete' };
      const tab = createMockTab({
        id: tabId,
        active: true,
      });

      activityEvents.onTabUpdated(tabId, changeInfo, tab);

      const emittedEvent = emitSpy.mock.calls[0]?.[0] as AgentEvent;
      expect(emittedEvent.payload.title).toBeUndefined();
    });
  });

  describe('onTabActivated', () => {
    it('should emit tab:activated event with tabId at top-level', () => {
      const activeInfo: chrome.tabs.OnActivatedInfo = {
        tabId: 42,
        windowId: 1,
      };

      activityEvents.onTabActivated(activeInfo);

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'tab:activated',
        tabId: 42,
        payload: {
          windowId: 1,
        },
      } satisfies AgentEvent);
    });

    it('should include windowId only in payload, not at top-level', () => {
      const activeInfo: chrome.tabs.OnActivatedInfo = {
        tabId: 99,
        windowId: 5,
      };

      activityEvents.onTabActivated(activeInfo);

      const emittedEvent = emitSpy.mock.calls[0]?.[0] as AgentEvent;
      expect(emittedEvent.tabId).toBe(99);
      expect(emittedEvent.windowId).toBeUndefined(); // windowId should NOT be at top-level
      expect(emittedEvent.payload.windowId).toBe(5);
    });
  });

  describe('onRuntimeMessage', () => {
    it('should forward content events with sender.tab?.id', () => {
      const message = {
        type: 'event',
        event: 'content:click',
        payload: { element: 'button', x: 100, y: 200 },
      };
      const sender: chrome.runtime.MessageSender = {
        tab: createMockTab({ id: 42 }),
      };

      const result = activityEvents.onRuntimeMessage(message, sender);

      expect(result).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'content:click',
        tabId: 42,
        payload: { element: 'button', x: 100, y: 200 },
      } satisfies AgentEvent);
    });

    it('should NOT forward events that are not type event', () => {
      const message = {
        type: 'request',
        method: 'ping',
        params: {},
      };
      const sender: chrome.runtime.MessageSender = {
        tab: createMockTab({ id: 42 }),
      };

      const result = activityEvents.onRuntimeMessage(message, sender);

      expect(result).toBe(false);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should NOT forward events without type field', () => {
      const message = {
        method: 'ping',
      };
      const sender: chrome.runtime.MessageSender = {
        tab: createMockTab({ id: 42 }),
      };

      const result = activityEvents.onRuntimeMessage(message, sender);

      expect(result).toBe(false);
      expect(emitSpy).not.toHaveBeenCalled();
    });

    it('should handle missing sender.tab gracefully', () => {
      const message = {
        type: 'event',
        event: 'some:event',
        payload: {},
      };
      const sender: chrome.runtime.MessageSender = {};

      const result = activityEvents.onRuntimeMessage(message, sender);

      expect(result).toBe(true);
      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'some:event',
        tabId: undefined,
        payload: {},
      } satisfies AgentEvent);
    });

    it('should handle content events with additional payload properties', () => {
      const message = {
        type: 'event',
        event: 'content:input',
        payload: {
          selector: '#search',
          value: 'test query',
          timestamp: Date.now(),
        },
      };
      const sender: chrome.runtime.MessageSender = {
        tab: createMockTab({ id: 123 }),
      };

      activityEvents.onRuntimeMessage(message, sender);

      const emittedEvent = emitSpy.mock.calls[0]?.[0] as AgentEvent;
      expect(emittedEvent.tabId).toBe(123);
      expect(emittedEvent.payload).toEqual({
        selector: '#search',
        value: 'test query',
        timestamp: expect.any(Number),
      });
    });

    it('should return false for null message', () => {
      const result = activityEvents.onRuntimeMessage(null, {});
      expect(result).toBe(false);
    });

    it('should return false for string message', () => {
      const result = activityEvents.onRuntimeMessage('not an object', {});
      expect(result).toBe(false);
    });
  });

  describe('listener integration', () => {
    it('should wire up onUpdated callback when attach() is called', () => {
      activityEvents.attach();

      // Simulate a tab update event
      const tabId = 42;
      const changeInfo: chrome.tabs.OnUpdatedInfo = { url: 'https://example.com', status: 'complete' };
      const tab = createMockTab({
        id: tabId,
        title: 'Example',
        active: true,
      });

      callbacks.onUpdatedCallbacks.forEach(cb => cb(tabId, changeInfo, tab));

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'tab:updated',
        tabId: 42,
        payload: {
          url: 'https://example.com',
          status: 'complete',
          title: 'Example',
        },
      } satisfies AgentEvent);
    });

    it('should wire up onActivated callback when attach() is called', () => {
      activityEvents.attach();

      // Simulate a tab activation event
      const activeInfo: chrome.tabs.OnActivatedInfo = { tabId: 99, windowId: 3 };

      callbacks.onActivatedCallbacks.forEach(cb => cb(activeInfo));

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'tab:activated',
        tabId: 99,
        payload: {
          windowId: 3,
        },
      } satisfies AgentEvent);
    });

    it('should wire up onMessage callback when attach() is called', () => {
      activityEvents.attach();

      // Simulate a message from content script
      const message = {
        type: 'event',
        event: 'content:scroll',
        payload: { scrollY: 500 },
      };
      const sender: chrome.runtime.MessageSender = {
        tab: createMockTab({ id: 77 }),
      };

      callbacks.onMessageCallbacks.forEach(cb => cb(message, sender));

      expect(emitSpy).toHaveBeenCalledWith({
        type: 'event',
        event: 'content:scroll',
        tabId: 77,
        payload: { scrollY: 500 },
      } satisfies AgentEvent);
    });
  });
});