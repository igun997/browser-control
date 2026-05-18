import type { AgentEvent } from '../shared/protocol.js';

/**
 * Interface for Chrome Debugger API (chrome.debugger)
 */
export interface ChromeDebuggerApi {
  attach(
    target: { tabId: number },
    version: string,
    callback?: () => void
  ): void;
  detach(target: { tabId: number }, callback?: () => void): void;
  sendCommand(
    target: { tabId: number },
    method: string,
    params?: Record<string, unknown>,
    callback?: (result: unknown) => void
  ): void;
  onEvent: {
    addListener(callback: ChromeDebuggerEventCallback): void;
    removeListener(callback: ChromeDebuggerEventCallback): void;
  };
}

/**
 * Callback for Chrome debugger events
 */
export type ChromeDebuggerEventCallback = (
  source: DebuggerSession,
  method: string,
  params?: unknown
) => void;

/**
 * Debugger session - represents the source of a debugger event
 */
export interface DebuggerSession {
  tabId?: number;
}

/**
 * Result of start() operation
 */
export interface StartResult {
  tabId: number;
  deepNetwork: 'started';
}

/**
 * Result of stop() operation
 */
export interface StopResult {
  tabId: number;
  deepNetwork: 'stopped';
}

/**
 * DeepNetworkInspector provides deep network debugging capabilities using Chrome's
 * debugger API (chrome.debugger). It attaches to tabs and monitors network events
 * via the Chrome DevTools Protocol (CDP).
 *
 * Unlike the basic NetworkInspector which uses webRequest API, DeepNetworkInspector
 * provides access to request/response bodies and more detailed network information.
 */
export class DeepNetworkInspector {
  private emit: (event: AgentEvent) => void;
  private debugger: ChromeDebuggerApi;
  private attachedTabs: Set<number> = new Set();

  /**
   * @param emit - Function to emit AgentEvent objects
   * @param debuggerApi - Optional chrome.debugger-like API for testing
   */
  constructor(
    emit: (event: AgentEvent) => void,
    debuggerApi?: ChromeDebuggerApi
  ) {
    this.emit = emit;
    this.debugger = debuggerApi ?? (chrome.debugger as unknown as ChromeDebuggerApi);
  }

  /**
   * Start deep network monitoring for a tab
   * @param tabId - The tab ID to attach debugger to
   * @returns Promise resolving to start result
   */
  async start(tabId: number): Promise<StartResult> {
    return new Promise((resolve, reject) => {
      this.debugger.attach(
        { tabId },
        '1.3',
        () => {
          this.attachedTabs.add(tabId);

          // Send Network.enable command
          this.debugger.sendCommand(
            { tabId },
            'Network.enable',
            {},
            (result) => {
              if (result instanceof Error) {
                reject(result);
              } else {
                resolve({ tabId, deepNetwork: 'started' });
              }
            }
          );
        }
      );

      // Handle attach errors (e.g., already attached)
      setTimeout(() => {
        if (!this.attachedTabs.has(tabId)) {
          // Try to attach and let the callback handle resolution
        }
      }, 0);
    });
  }

  /**
   * Stop deep network monitoring for a tab
   * @param tabId - The tab ID to detach debugger from
   * @returns Promise resolving to stop result
   */
  async stop(tabId: number): Promise<StopResult> {
    return new Promise((resolve) => {
      if (!this.attachedTabs.has(tabId)) {
        resolve({ tabId, deepNetwork: 'stopped' });
        return;
      }

      this.debugger.detach({ tabId }, () => {
        this.attachedTabs.delete(tabId);
        resolve({ tabId, deepNetwork: 'stopped' });
      });
    });
  }

  /**
   * Get the response body for a network request
   * @param tabId - The tab ID where the request was made
   * @param requestId - The request ID from the CDP event
   * @returns Promise resolving to the response body
   */
  async getResponseBody(tabId: number, requestId: string): Promise<unknown> {
    if (typeof requestId !== 'string' || requestId.length === 0) {
      throw new Error('requestId must be a non-empty string');
    }

    return new Promise((resolve, reject) => {
      this.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId },
        (result) => {
          if (result instanceof Error) {
            reject(result);
          } else {
            resolve(result);
          }
        }
      );
    });
  }

  /**
   * Handle a CDP event from the debugger
   * @param source - The source of the event (contains tabId)
   * @param method - The CDP method name
   * @param params - The event parameters
   */
  handleEvent(
    source: DebuggerSession,
    method: string,
    params?: unknown
  ): void {
    // Only process if source has tabId and method starts with 'Network.'
    if (!source.tabId || !method.startsWith('Network.')) {
      return;
    }

    // Convert params to Record<string, unknown> if possible
    const payload: Record<string, unknown> =
      params && typeof params === 'object' ? params as Record<string, unknown> : {};

    this.emit({
      type: 'event',
      event: `cdp:${method}`,
      tabId: source.tabId,
      payload,
    });
  }

  /**
   * Check if a tab is currently being monitored
   * @param tabId - The tab ID to check
   * @returns True if the tab is attached
   */
  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  /**
   * Get the list of attached tab IDs
   * @returns Array of attached tab IDs
   */
  getAttachedTabs(): number[] {
    return Array.from(this.attachedTabs);
  }
}