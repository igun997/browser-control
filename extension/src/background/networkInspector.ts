import type { AgentEvent } from '../shared/protocol.js';

/**
 * Headers to redact for privacy/security
 */
const HEADERS_TO_REDACT = new Set([
  'authorization',
  'cookie',
  'set-cookie',
]);

/**
 * Network request/response data stored during request lifecycle
 */
interface RequestData {
  url: string;
  method: string;
  type?: string;
  frameId?: number;
  timestamp?: number;
  status?: number;
  headers?: Array<{ name: string; value: string }>;
  error?: string;
}

/**
 * NetworkInspector monitors HTTP network activity by registering chrome.webRequest listeners.
 * It correlates request lifecycle events and emits structured events for the agent.
 */
export class NetworkInspector {
  private emit: (event: string, payload: Record<string, unknown>) => void;
  private requests: Map<string, RequestData> = new Map();
  private attached = false;

  /**
   * @param emit - Function to emit events (typically AgentSocket.sendEvent)
   */
  constructor(emit: (event: string, payload: Record<string, unknown>) => void) {
    this.emit = emit;
  }

  /**
   * Register chrome.webRequest listeners for <all_urls>.
   * This enables monitoring of all HTTP/HTTPS requests.
   */
  attach(): void {
    if (this.attached) {
      return; // Idempotent
    }
    this.attached = true;

    // onBeforeRequest - fires when request is about to be made
    chrome.webRequest.onBeforeRequest.addListener(
      this.onBeforeRequest.bind(this),
      { urls: ['<all_urls>'] },
      ['requestBody']
    );

    // onBeforeSendHeaders - fires before sending headers (for request header redaction)
    // Note: only supports specific resource types: main_frame, sub_frame, xmlhttprequest, websocket
    chrome.webRequest.onBeforeSendHeaders.addListener(
      this.onBeforeSendHeaders.bind(this),
      { urls: ['<all_urls>'], types: ['main_frame', 'sub_frame', 'xmlhttprequest', 'websocket'], tabId: -1 },
      ['requestHeaders']
    );

    // onHeadersReceived - fires when response headers are received
    chrome.webRequest.onHeadersReceived.addListener(
      this.onHeadersReceived.bind(this),
      { urls: ['<all_urls>'] },
      ['responseHeaders']
    );

    // onCompleted - fires when request completes successfully
    chrome.webRequest.onCompleted.addListener(
      this.onCompleted.bind(this),
      { urls: ['<all_urls>'] },
      []
    );

    // onErrorOccurred - fires when request fails
    chrome.webRequest.onErrorOccurred.addListener(
      this.onErrorOccurred.bind(this),
      { urls: ['<all_urls>'] },
      []
    );
  }

  /**
   * Remove all registered listeners.
   */
  detach(): void {
    if (!this.attached) {
      return;
    }
    this.attached = false;

    chrome.webRequest.onBeforeRequest.removeListener(this.onBeforeRequest);
    chrome.webRequest.onBeforeSendHeaders.removeListener(this.onBeforeSendHeaders);
    chrome.webRequest.onHeadersReceived.removeListener(this.onHeadersReceived);
    chrome.webRequest.onCompleted.removeListener(this.onCompleted);
    chrome.webRequest.onErrorOccurred.removeListener(this.onErrorOccurred);
  }

  /**
   * Redact sensitive header values, returning a new array.
   */
  redactHeaders(headers: Array<{ name: string; value: string }>): Array<{ name: string; value: string }> {
    return headers.map((header) => {
      const nameLower = header.name.toLowerCase();
      if (HEADERS_TO_REDACT.has(nameLower)) {
        return { name: header.name, value: '<redacted>' };
      }
      return header;
    });
  }

  /**
   * Handle onBeforeRequest event - emit network:request
   */
  private onBeforeRequest(details: chrome.webRequest.OnBeforeRequestDetails): undefined {
    const { requestId, url, method, type, frameId, timeStamp } = details;

    // Store request data for correlation
    const data: RequestData = { url, method };
    if (type) data.type = type;
    if (frameId !== undefined) data.frameId = frameId;
    data.timestamp = timeStamp;

    this.requests.set(requestId, data);

    // Emit network:request event
    this.emit('network:request', {
      requestId,
      url,
      method,
      type,
      frameId,
      timestamp: timeStamp,
    });

    return undefined;
  }

  /**
   * Handle onBeforeSendHeaders event - capture request headers (for future use)
   */
  private onBeforeSendHeaders(details: chrome.webRequest.OnBeforeSendHeadersDetails): undefined {
    const { requestId, requestHeaders } = details;

    if (requestHeaders) {
      const redacted = this.redactHeaders(requestHeaders as Array<{ name: string; value: string }>);
      // Optionally store redacted headers for correlation
      const existing = this.requests.get(requestId);
      if (existing) {
        existing.headers = redacted;
      }
    }

    return undefined;
  }

  /**
   * Handle onHeadersReceived event - emit network:response
   */
  private onHeadersReceived(details: chrome.webRequest.OnHeadersReceivedDetails): undefined {
    const { requestId, statusLine, statusCode, responseHeaders, timeStamp } = details;

    // Redact sensitive headers
    const redactedHeaders: Array<{ name: string; value: string }> | undefined = responseHeaders
      ? this.redactHeaders(responseHeaders as Array<{ name: string; value: string }>)
      : undefined;

    // Update stored data
    const existing = this.requests.get(requestId);
    if (existing) {
      existing.status = statusCode;
      if (redactedHeaders) {
        existing.headers = redactedHeaders;
      }
    }

    // Emit network:response event
    this.emit('network:response', {
      requestId,
      url: details.url,
      status: statusCode,
      statusLine,
      headers: redactedHeaders,
      timestamp: timeStamp,
    });

    return undefined;
  }

  /**
   * Handle onCompleted event - emit network:complete
   */
  private onCompleted(details: chrome.webRequest.OnCompletedDetails): undefined {
    const { requestId, statusCode, timeStamp } = details;

    // Clean up stored data
    this.requests.delete(requestId);

    // Emit network:complete event
    this.emit('network:complete', {
      requestId,
      url: details.url,
      status: statusCode,
      timestamp: timeStamp,
    });

    return undefined;
  }

  /**
   * Handle onErrorOccurred event - emit network:error
   */
  private onErrorOccurred(details: chrome.webRequest.OnErrorOccurredDetails): undefined {
    const { requestId, error, timeStamp } = details;

    // Clean up stored data
    this.requests.delete(requestId);

    // Emit network:error event
    this.emit('network:error', {
      requestId,
      url: details.url,
      error,
      timestamp: timeStamp,
    });

    return undefined;
  }
}