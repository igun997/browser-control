import type { AgentEvent } from '../shared/protocol.js';

export class ActivityEvents {
  private emit: (event: AgentEvent) => void;

  constructor(emit: (event: AgentEvent) => void) {
    this.emit = emit;
  }

  /**
   * Register all Chrome event listeners.
   * Should be called once after initialization.
   */
  attach(): void {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.onTabUpdated(tabId, changeInfo, tab);
    });

    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.onTabActivated(activeInfo);
    });

    chrome.runtime.onMessage.addListener((message, sender) => {
      return this.onRuntimeMessage(message, sender);
    });
  }

  /**
   * Handle tab update events (URL changes, loading status, etc.)
   */
  onTabUpdated(
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ): void {
    this.emit({
      type: 'event',
      event: 'tab:updated',
      tabId,
      payload: {
        url: changeInfo.url,
        status: changeInfo.status,
        title: tab.title,
      },
    });
  }

  /**
   * Handle tab activation events (user switches to a different tab)
   * Note: windowId is included in payload only, not at top-level,
   * to avoid redundancy since the protocol primarily uses tabId.
   */
  onTabActivated(activeInfo: chrome.tabs.OnActivatedInfo): void {
    this.emit({
      type: 'event',
      event: 'tab:activated',
      tabId: activeInfo.tabId,
      payload: {
        windowId: activeInfo.windowId,
      },
    });
  }

  /**
   * Handle runtime messages from content scripts and other extension components.
   * Forwards content events to the agent socket.
   * @returns true if the message was handled, false otherwise
   */
  onRuntimeMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender
  ): boolean {
    // Ensure message is an object with expected structure
    if (typeof message !== 'object' || message === null) {
      return false;
    }

    const msg = message as Record<string, unknown>;

    // Only forward messages with type: 'event'
    if (msg.type !== 'event') {
      return false;
    }

    if (typeof msg.event !== 'string') {
      return false;
    }

    const tabId = sender.tab?.id;
    const payload = (msg.payload as Record<string, unknown>) ?? {};

    this.emit({
      type: 'event',
      event: msg.event,
      tabId,
      payload,
    });

    return true;
  }
}