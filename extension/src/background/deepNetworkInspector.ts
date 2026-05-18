import type { AgentEvent } from '../shared/protocol.js';

/**
 * Interface for Chrome Debugger API (chrome.debugger)
 * Supports optional lastError for error handling
 */
export interface ChromeDebuggerApi {
  attach(
    target: { tabId: number },
    version: string,
    callback?: (lastError?: { message: string }) => void
  ): void;
  detach(target: { tabId: number }, callback?: (lastError?: { message: string }) => void): void;
  sendCommand(
    target: { tabId: number },
    method: string,
    params?: Record<string, unknown>,
    callback?: (result: unknown, lastError?: { message: string }) => void
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
   * @throws Error if attach or Network.enable fails
   */
  async start(tabId: number): Promise<StartResult> {
    return new Promise((resolve, reject) => {
      this.debugger.attach({ tabId }, '1.3', (attachError) => {
        if (attachError) {
          reject(new Error(`Failed to attach debugger: ${attachError.message}`));
          return;
        }

        // Send Network.enable command
        this.debugger.sendCommand(
          { tabId },
          'Network.enable',
          {},
          (_result, enableError) => {
            if (enableError) {
              // Network.enable failed - detach and reject, don't leave tab tracked
              this.debugger.detach({ tabId }, () => {
                // Detach callback - ignore its error since we're already rejecting
              });
              reject(new Error(`Failed to enable Network: ${enableError.message}`));
              return;
            }
            this.attachedTabs.add(tabId);
            resolve({ tabId, deepNetwork: 'started' });
          }
        );
      });
    });
  }

  /**
   * Stop deep network monitoring for a tab
   * @param tabId - The tab ID to detach debugger from
   * @returns Promise resolving to stop result
   * @throws Error if detach fails
   */
  async stop(tabId: number): Promise<StopResult> {
    return new Promise((resolve, reject) => {
      if (!this.attachedTabs.has(tabId)) {
        resolve({ tabId, deepNetwork: 'stopped' });
        return;
      }

      this.debugger.detach({ tabId }, (detachError) => {
        if (detachError) {
          // Detach failed - keep tracking, reject with error
          reject(new Error(`Failed to detach debugger: ${detachError.message}`));
          return;
        }
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
   * @throws Error if command fails
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
        (result, commandError) => {
          if (commandError) {
            reject(new Error(`Failed to get response body: ${commandError.message}`));
            return;
          }
          resolve(result);
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
    // Only process events for tabs that are currently attached
    if (!source.tabId || !this.attachedTabs.has(source.tabId)) {
      return;
    }

    // Only process Network.* events
    if (!method.startsWith('Network.')) {
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