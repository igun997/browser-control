import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandRouter } from './commandRouter.js';
import { BrowserControlsError } from '../shared/errors.js';

// Mock chrome API
const mockChrome = {
  tabs: {
    query: vi.fn(),
    update: vi.fn(),
    sendMessage: vi.fn(),
    captureVisibleTab: vi.fn(),
  },
};

vi.stubGlobal('chrome', mockChrome);

describe('CommandRouter', () => {
  let router: CommandRouter;

  beforeEach(() => {
    vi.clearAllMocks();
    router = new CommandRouter();
    router.setActiveTabId(42);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('navigate', () => {
    it('should navigate to URL on specified tab', async () => {
      mockChrome.tabs.update.mockResolvedValue({ id: 1, url: 'https://example.com' });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'navigate',
        params: { tabId: 1, url: 'https://example.com' },
      });

      expect(mockChrome.tabs.update).toHaveBeenCalledWith(1, { url: 'https://example.com' });
      expect(result).toEqual({ tabId: 1, url: 'https://example.com' });
    });

    it('should resolve "active" tabId from activeTabId', async () => {
      mockChrome.tabs.update.mockResolvedValue({ id: 42, url: 'https://example.com' });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'navigate',
        params: { tabId: 'active', url: 'https://example.com' },
      });

      expect(mockChrome.tabs.update).toHaveBeenCalledWith(42, { url: 'https://example.com' });
      expect(result).toEqual({ tabId: 42, url: 'https://example.com' });
    });

    it('should reject invalid URL schemes', async () => {
      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'navigate',
          params: { tabId: 1, url: 'file:///path/to/file' },
        })
      ).rejects.toThrow(BrowserControlsError);

      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'navigate',
          params: { tabId: 1, url: 'javascript:alert(1)' },
        })
      ).rejects.toThrow(BrowserControlsError);
    });

    it('should throw INVALID_URL for non-string URL', async () => {
      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'navigate',
          params: { tabId: 1, url: 123 },
        })
      ).rejects.toThrow(BrowserControlsError);

      try {
        await router.handle({
          id: 'req-1',
          type: 'request',
          method: 'navigate',
          params: { tabId: 1, url: 123 },
        });
      } catch (e) {
        expect(e).toBeInstanceOf(BrowserControlsError);
        expect((e as BrowserControlsError).code).toBe('INVALID_URL');
      }
    });

    it('should throw for invalid tab target', async () => {
      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'navigate',
          params: { tabId: 'invalid', url: 'https://example.com' },
        })
      ).rejects.toThrow();
    });

    it('should navigate to http URLs', async () => {
      mockChrome.tabs.update.mockResolvedValue({ id: 1, url: 'http://example.com' });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'navigate',
        params: { tabId: 1, url: 'http://example.com' },
      });

      expect(mockChrome.tabs.update).toHaveBeenCalledWith(1, { url: 'http://example.com' });
      expect(result).toEqual({ tabId: 1, url: 'http://example.com' });
    });
  });

  describe('content script commands (inspect, query DOM, click, type, scroll, inspect:start, inspect:stop)', () => {
    it('should send inspect command to content script', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true, result: { selector: '#test' } });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'inspect',
        params: { tabId: 1, selector: '#test' },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        method: 'inspect',
        params: { tabId: 1, selector: '#test' },
      });
      expect(result).toEqual({ selector: '#test' });
    });

    it('should send query DOM command to content script', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({
        ok: true,
        result: [{ selector: '#div1' }, { selector: '#div2' }],
      });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'query DOM',
        params: { tabId: 1, selector: 'div' },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        method: 'query DOM',
        params: { tabId: 1, selector: 'div' },
      });
      expect(result).toEqual([{ selector: '#div1' }, { selector: '#div2' }]);
    });

    it('should send click command to content script', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true, result: { clicked: true } });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'click',
        params: { tabId: 1, selector: '#button' },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        method: 'click',
        params: { tabId: 1, selector: '#button' },
      });
      expect(result).toEqual({ clicked: true });
    });

    it('should send type command to content script', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true, result: { typed: 'hello' } });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'type',
        params: { tabId: 1, selector: '#input', text: 'hello' },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        method: 'type',
        params: { tabId: 1, selector: '#input', text: 'hello' },
      });
      expect(result).toEqual({ typed: 'hello' });
    });

    it('should send scroll command to content script', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true, result: { scrolled: true } });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'scroll',
        params: { tabId: 1, direction: 'down' },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        method: 'scroll',
        params: { tabId: 1, direction: 'down' },
      });
      expect(result).toEqual({ scrolled: true });
    });

    it('should send inspect:start command to content script', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true, result: { started: true } });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'inspect:start',
        params: { tabId: 1 },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        method: 'inspect:start',
        params: { tabId: 1 },
      });
      expect(result).toEqual({ started: true });
    });

    it('should send inspect:stop command to content script', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true, result: { stopped: true } });

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'inspect:stop',
        params: { tabId: 1 },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(1, {
        method: 'inspect:stop',
        params: { tabId: 1 },
      });
      expect(result).toEqual({ stopped: true });
    });

    it('should resolve "active" tabId for content commands', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({ ok: true, result: {} });

      await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'inspect',
        params: { tabId: 'active', selector: '#test' },
      });

      expect(mockChrome.tabs.sendMessage).toHaveBeenCalledWith(42, {
        method: 'inspect',
        params: { tabId: 'active', selector: '#test' },
      });
    });

    it('should throw CONTENT_COMMAND_FAILED when content script returns error', async () => {
      mockChrome.tabs.sendMessage.mockResolvedValue({
        ok: false,
        error: { code: 'ELEMENT_NOT_FOUND', message: 'No element found' },
      });

      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'inspect',
          params: { tabId: 1, selector: '#missing' },
        })
      ).rejects.toThrow(BrowserControlsError);

      try {
        await router.handle({
          id: 'req-1',
          type: 'request',
          method: 'inspect',
          params: { tabId: 1, selector: '#missing' },
        });
      } catch (e) {
        expect(e).toBeInstanceOf(BrowserControlsError);
        expect((e as BrowserControlsError).code).toBe('CONTENT_COMMAND_FAILED');
        expect((e as BrowserControlsError).message).toBe('No element found');
      }
    });

    it('should throw CONTENT_COMMAND_FAILED when sendMessage fails', async () => {
      mockChrome.tabs.sendMessage.mockRejectedValue(new Error('Connection refused'));

      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'inspect',
          params: { tabId: 1, selector: '#test' },
        })
      ).rejects.toThrow(BrowserControlsError);

      try {
        await router.handle({
          id: 'req-1',
          type: 'request',
          method: 'inspect',
          params: { tabId: 1, selector: '#test' },
        });
      } catch (e) {
        expect(e).toBeInstanceOf(BrowserControlsError);
        expect((e as BrowserControlsError).code).toBe('CONTENT_COMMAND_FAILED');
      }
    });
  });

  describe('screenshot', () => {
    it('should capture visible tab and return dataUrl with tabId when activeTabId set', async () => {
      mockChrome.tabs.query.mockResolvedValue([{ id: 42, windowId: 1 }]);
      mockChrome.tabs.captureVisibleTab.mockResolvedValue('data:image/png;base64,xyz123');

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'screenshot',
        params: {},
      });

      expect(mockChrome.tabs.query).toHaveBeenCalledWith({});
      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenCalledWith(1, { format: 'png' });
      expect(result).toEqual({ dataUrl: 'data:image/png;base64,xyz123', tabId: 42 });
    });

    it('should use active tab from chrome.tabs.query when no activeTabId set', async () => {
      router = new CommandRouter(); // No activeTabId set
      mockChrome.tabs.query
        .mockResolvedValueOnce([{ id: 99, windowId: 2, active: true, currentWindow: true }])
        .mockResolvedValue([{ id: 99, windowId: 2 }]);
      mockChrome.tabs.captureVisibleTab.mockResolvedValue('data:image/png;base64,abc');

      const result = await router.handle({
        id: 'req-1',
        type: 'request',
        method: 'screenshot',
        params: {},
      });

      expect(mockChrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(mockChrome.tabs.captureVisibleTab).toHaveBeenCalledWith(2, { format: 'png' });
      expect(result).toEqual({ dataUrl: 'data:image/png;base64,abc', tabId: 99 });
    });

    it('should throw NO_ACTIVE_TAB when no active tab found', async () => {
      router = new CommandRouter();
      mockChrome.tabs.query.mockResolvedValue([]);

      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'screenshot',
          params: {},
        })
      ).rejects.toThrow(BrowserControlsError);

      try {
        await router.handle({
          id: 'req-1',
          type: 'request',
          method: 'screenshot',
          params: {},
        });
      } catch (e) {
        expect(e).toBeInstanceOf(BrowserControlsError);
        expect((e as BrowserControlsError).code).toBe('NO_ACTIVE_TAB');
      }
    });

    it('should throw NO_ACTIVE_TAB when tab has no windowId', async () => {
      router = new CommandRouter(); // No activeTabId set
      mockChrome.tabs.query.mockResolvedValue([{ id: 99, active: true, currentWindow: true }]); // No windowId

      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'screenshot',
          params: {},
        })
      ).rejects.toThrow(BrowserControlsError);

      try {
        await router.handle({
          id: 'req-1',
          type: 'request',
          method: 'screenshot',
          params: {},
        });
      } catch (e) {
        expect(e).toBeInstanceOf(BrowserControlsError);
        expect((e as BrowserControlsError).code).toBe('NO_ACTIVE_TAB');
      }
    });
  });

  describe('unknown method', () => {
    it('should throw UNKNOWN_METHOD for unknown commands', async () => {
      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: 'unknownMethod',
          params: {},
        })
      ).rejects.toThrow(BrowserControlsError);

      try {
        await router.handle({
          id: 'req-1',
          type: 'request',
          method: 'unknownMethod',
          params: {},
        });
      } catch (e) {
        expect(e).toBeInstanceOf(BrowserControlsError);
        expect((e as BrowserControlsError).code).toBe('UNKNOWN_METHOD');
        expect((e as BrowserControlsError).message).toBe('Unknown method: unknownMethod');
      }
    });

    it('should throw UNKNOWN_METHOD for empty string method', async () => {
      await expect(
        router.handle({
          id: 'req-1',
          type: 'request',
          method: '',
          params: {},
        })
      ).rejects.toThrow(BrowserControlsError);
    });
  });

  describe('setActiveTabId', () => {
    it('should allow updating active tab ID', () => {
      router.setActiveTabId(100);
      router.setActiveTabId(200);
      router.setActiveTabId(undefined);
      // No assertion needed - just verify no throws
    });
  });
});
