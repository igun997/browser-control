import { BrowserControlsError } from '../shared/errors.js';
import { AgentRequest, resolveTabTarget } from '../shared/protocol.js';
import type { DeepNetworkInspector } from './deepNetworkInspector.js';

// Content script message types
interface ContentMessage {
  method: string;
  params: Record<string, unknown>;
}

interface ContentResponse {
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

// Helper to resolve tab target from params.tabId
// Falls back to querying Chrome for the current active tab when tabId is 'active'
// and no activeTabId is set (e.g., popup-initiated commands)
async function resolveTabIdParam(tabId: unknown, activeTabId: number | undefined): Promise<number> {
  // When tabId is omitted (undefined) or 'active', and no activeTabId cached,
  // query Chrome for the current active tab.
  if ((tabId === undefined || tabId === 'active') && activeTabId === undefined) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new BrowserControlsError('NO_ACTIVE_TAB', 'No active tab available');
    }
    return tab.id;
  }
  // If tabId omitted but activeTabId is set, use it
  if (tabId === undefined) {
    return activeTabId!;
  }
  return resolveTabTarget(tabId, activeTabId);
}

// Check if URL is valid http/https
function isValidHttpUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Commands that route to content script
const CONTENT_SCRIPT_METHODS = new Set([
  'inspect',
  'query DOM',
  'click',
  'type',
  'scroll',
  'inspect:start',
  'inspect:stop',
]);

export class CommandRouter {
  private activeTabId: number | undefined;
  private deepNetworkInspector: DeepNetworkInspector | undefined;

  /**
   * Set the active tab ID for 'active' tab target resolution
   */
  setActiveTabId(tabId: number | undefined): void {
    this.activeTabId = tabId;
  }

  /**
   * Set the DeepNetworkInspector for deep network debugging commands
   */
  setDeepNetworkInspector(inspector: DeepNetworkInspector): void {
    this.deepNetworkInspector = inspector;
  }

  /**
   * Handle incoming agent request
   */
  async handle(request: AgentRequest): Promise<unknown> {
    const { method, params } = request;

    switch (method) {
      case 'navigate':
        return this.handleNavigate(params);

      case 'screenshot':
        return this.handleScreenshot();

      case 'network:deep:start':
        return this.handleDeepNetworkStart(params);

      case 'network:deep:stop':
        return this.handleDeepNetworkStop(params);

      case 'network:getResponseBody':
        return this.handleGetResponseBody(params);

      default:
        if (CONTENT_SCRIPT_METHODS.has(method)) {
          return this.handleContentCommand(method, params);
        }
        throw new BrowserControlsError('UNKNOWN_METHOD', `Unknown method: ${method}`);
    }
  }

  private async handleNavigate(params: Record<string, unknown>): Promise<{ tabId: number; url: string }> {
    const url = params.url;
    if (!isValidHttpUrl(url)) {
      throw new BrowserControlsError('INVALID_URL', 'URL must be a valid http or https URL');
    }

    const tabId = await resolveTabIdParam(params.tabId, this.activeTabId);

    await chrome.tabs.update(tabId, { url });

    return { tabId, url: url as string };
  }

  private async handleScreenshot(): Promise<{ dataUrl: string; tabId: number }> {
    // Use active tab if available, otherwise get current window's active tab
    let tabId: number;
    let windowId: number;

    if (this.activeTabId !== undefined) {
      tabId = this.activeTabId;
      // Query all tabs and filter to find the tab with matching id
      const allTabs = await chrome.tabs.query({});
      const tab = allTabs.find(t => t.id === tabId);
      if (!tab || tab.windowId === undefined) {
        throw new BrowserControlsError('NO_ACTIVE_TAB', 'No active tab found for screenshot');
      }
      windowId = tab.windowId;
    } else {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab || !activeTab.id || activeTab.windowId === undefined) {
        throw new BrowserControlsError('NO_ACTIVE_TAB', 'No active tab found for screenshot');
      }
      tabId = activeTab.id;
      windowId = activeTab.windowId;
    }

    const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' as const });
    return { dataUrl, tabId };
  }

  private async handleDeepNetworkStart(params: Record<string, unknown>): Promise<{ tabId: number; deepNetwork: 'started' }> {
    if (!this.deepNetworkInspector) {
      throw new BrowserControlsError(
        'DEEP_NETWORK_UNAVAILABLE',
        'Deep network inspector is not available'
      );
    }

    const tabId = await resolveTabIdParam(params.tabId, this.activeTabId);

    return this.deepNetworkInspector.start(tabId);
  }

  private async handleDeepNetworkStop(params: Record<string, unknown>): Promise<{ tabId: number; deepNetwork: 'stopped' }> {
    if (!this.deepNetworkInspector) {
      throw new BrowserControlsError(
        'DEEP_NETWORK_UNAVAILABLE',
        'Deep network inspector is not available'
      );
    }

    const tabId = await resolveTabIdParam(params.tabId, this.activeTabId);

    return this.deepNetworkInspector.stop(tabId);
  }

  private async handleGetResponseBody(params: Record<string, unknown>): Promise<unknown> {
    if (!this.deepNetworkInspector) {
      throw new BrowserControlsError(
        'DEEP_NETWORK_UNAVAILABLE',
        'Deep network inspector is not available'
      );
    }

    const tabId = await resolveTabIdParam(params.tabId, this.activeTabId);
    const requestId = params.requestId;

    // Validate requestId is a non-empty string
    if (typeof requestId !== 'string' || requestId.length === 0) {
      throw new BrowserControlsError(
        'INVALID_REQUEST_ID',
        'requestId must be a non-empty string'
      );
    }

    return this.deepNetworkInspector.getResponseBody(tabId, requestId);
  }

  /**
   * Send a message to the content script, injecting it first if needed.
   */
  private async sendToContentScript(tabId: number, message: ContentMessage): Promise<ContentResponse> {
    try {
      return await chrome.tabs.sendMessage(tabId, message) as ContentResponse;
    } catch {
      // Content script likely not injected — inject and retry once
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
      return await chrome.tabs.sendMessage(tabId, message) as ContentResponse;
    }
  }

  private async handleContentCommand(
    method: string,
    params: Record<string, unknown>
  ): Promise<unknown> {
    const tabId = await resolveTabIdParam(params.tabId, this.activeTabId);

    const message: ContentMessage = { method, params };

    try {
      const response = await this.sendToContentScript(tabId, message);

      if (response.ok) {
        return response.result;
      }

      // Content script returned an error
      throw new BrowserControlsError(
        'CONTENT_COMMAND_FAILED',
        response.error?.message ?? 'Content command failed',
        response.error
      );
    } catch (err) {
      // Handle cases where sendMessage fails (tab not loaded, no content script, etc.)
      if (err instanceof BrowserControlsError) {
        throw err;
      }
      throw new BrowserControlsError(
        'CONTENT_COMMAND_FAILED',
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}