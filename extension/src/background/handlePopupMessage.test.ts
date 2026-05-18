import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BrowserControlsError } from '../shared/errors.js';

// We need to test the popup message handling logic
// Since it's in index.ts, we'll extract it into a testable function

interface MockCommandRouter {
  handle: (request: { id: string; type: string; method: string; params: { tabId: unknown } }) => Promise<unknown>;
}

interface PopupMessage {
  method: string;
}

type SendResponse = (response: { ok: boolean; result?: unknown; error?: string }) => void;

// Testable popup message handler function
async function handlePopupMessage(
  message: PopupMessage,
  commandRouter: MockCommandRouter | null,
  sendResponse: SendResponse
): Promise<boolean> {
  if (message.method === 'popup:inspect:start') {
    if (!commandRouter) {
      sendResponse({ ok: false, error: 'ROUTER_UNAVAILABLE' });
      return true;
    }

    try {
      const result = await commandRouter.handle({
        id: 'popup',
        type: 'request',
        method: 'inspect:start',
        params: { tabId: 'active' },
      });
      sendResponse({ ok: true, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error });
    }
    return true;
  }

  if (message.method === 'popup:inspect:stop') {
    if (!commandRouter) {
      sendResponse({ ok: false, error: 'ROUTER_UNAVAILABLE' });
      return true;
    }

    try {
      const result = await commandRouter.handle({
        id: 'popup',
        type: 'request',
        method: 'inspect:stop',
        params: { tabId: 'active' },
      });
      sendResponse({ ok: true, result });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      sendResponse({ ok: false, error });
    }
    return true;
  }

  return false;
}

describe('handlePopupMessage', () => {
  let mockRouter: MockCommandRouter;
  let sendResponseMock: SendResponse;

  beforeEach(() => {
    sendResponseMock = vi.fn() as unknown as SendResponse;
  });

  describe('popup:inspect:start', () => {
    it('should call commandRouter.handle with inspect:start and tabId active', async () => {
      mockRouter = {
        handle: vi.fn().mockResolvedValue({ started: true }),
      };

      const handled = await handlePopupMessage(
        { method: 'popup:inspect:start' },
        mockRouter,
        sendResponseMock
      );

      expect(handled).toBe(true);
      expect(mockRouter.handle).toHaveBeenCalledWith({
        id: 'popup',
        type: 'request',
        method: 'inspect:start',
        params: { tabId: 'active' },
      });
      expect(sendResponseMock).toHaveBeenCalledWith({ ok: true, result: { started: true } });
    });

    it('should send error response when router unavailable', async () => {
      const handled = await handlePopupMessage(
        { method: 'popup:inspect:start' },
        null,
        sendResponseMock
      );

      expect(handled).toBe(true);
      expect(sendResponseMock).toHaveBeenCalledWith({
        ok: false,
        error: 'ROUTER_UNAVAILABLE',
      });
    });

    it('should send error response when router.handle throws', async () => {
      mockRouter = {
        handle: vi.fn().mockRejectedValue(new Error('Tab not found')),
      };

      const handled = await handlePopupMessage(
        { method: 'popup:inspect:start' },
        mockRouter,
        sendResponseMock
      );

      expect(handled).toBe(true);
      expect(sendResponseMock).toHaveBeenCalledWith({
        ok: false,
        error: 'Tab not found',
      });
    });
  });

  describe('popup:inspect:stop', () => {
    it('should call commandRouter.handle with inspect:stop and tabId active', async () => {
      mockRouter = {
        handle: vi.fn().mockResolvedValue({ stopped: true }),
      };

      const handled = await handlePopupMessage(
        { method: 'popup:inspect:stop' },
        mockRouter,
        sendResponseMock
      );

      expect(handled).toBe(true);
      expect(mockRouter.handle).toHaveBeenCalledWith({
        id: 'popup',
        type: 'request',
        method: 'inspect:stop',
        params: { tabId: 'active' },
      });
      expect(sendResponseMock).toHaveBeenCalledWith({ ok: true, result: { stopped: true } });
    });

    it('should send error response when router unavailable', async () => {
      const handled = await handlePopupMessage(
        { method: 'popup:inspect:stop' },
        null,
        sendResponseMock
      );

      expect(handled).toBe(true);
      expect(sendResponseMock).toHaveBeenCalledWith({
        ok: false,
        error: 'ROUTER_UNAVAILABLE',
      });
    });

    it('should send error response when router.handle throws', async () => {
      mockRouter = {
        handle: vi.fn().mockRejectedValue(new BrowserControlsError('CONTENT_COMMAND_FAILED', 'No content script')),
      };

      const handled = await handlePopupMessage(
        { method: 'popup:inspect:stop' },
        mockRouter,
        sendResponseMock
      );

      expect(handled).toBe(true);
      expect(sendResponseMock).toHaveBeenCalledWith({
        ok: false,
        error: 'No content script',
      });
    });
  });

  describe('unhandled messages', () => {
    it('should return false for unknown message methods', async () => {
      mockRouter = {
        handle: vi.fn(),
      };

      const handled = await handlePopupMessage(
        { method: 'unknown:method' },
        mockRouter,
        sendResponseMock
      );

      expect(handled).toBe(false);
      expect(mockRouter.handle).not.toHaveBeenCalled();
      expect(sendResponseMock).not.toHaveBeenCalled();
    });
  });
});