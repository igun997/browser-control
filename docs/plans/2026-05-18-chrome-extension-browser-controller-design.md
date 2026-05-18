# Chrome Extension Browser Controller Design

## Goal

Build Chrome extension browser controller with extension UI and outbound WebSocket transport to local agent server. Extension controls/observes Chrome tabs, supports navigation, DOM inspect, interaction commands, screenshots, activity streaming, and hybrid network inspection.

## Architecture

Chrome extension owns browser access. Local agent owns orchestration. Extension opens outbound WebSocket to `ws://localhost:<port>` from background service worker. Agent server accepts connection, registers browser session, sends JSON-RPC style commands. Extension routes commands to `active` tab or specified `tabId`.

Components:

- `background`: WebSocket lifecycle, tab registry, command router, screenshot via `chrome.tabs.captureVisibleTab`, navigation via `chrome.tabs.update`, network capture via `chrome.webRequest`, optional CDP via `chrome.debugger`.
- `content script`: DOM executor for query/inspect/click/type/scroll, hover/selection tracking, element serialization, inspect overlay.
- `popup/devtools UI`: connection status, port config, token config, session id, inspect picker toggle, network deep-mode status, recent events.
- `agent server`: local WebSocket endpoint, tool adapter, command timeout/retry, event log, body storage/truncation policy.

## Protocol

Use JSON messages with request/response/events:

```json
{
  "id": "cmd_123",
  "type": "request",
  "method": "navigate",
  "params": {
    "tabId": "active",
    "url": "https://example.com"
  }
}
```

```json
{
  "id": "cmd_123",
  "type": "response",
  "result": {
    "tabId": 123,
    "url": "https://example.com",
    "status": "loading"
  }
}
```

```json
{
  "type": "event",
  "event": "inspect:hover",
  "tabId": 123,
  "payload": {
    "selector": "button.primary",
    "text": "Submit",
    "bounds": { "x": 10, "y": 20, "width": 80, "height": 32 }
  }
}
```

Startup handshake:

1. Extension reads port/token config.
2. Background connects `ws://localhost:<port>`.
3. Extension sends `hello` with extension version, permissions, tabs summary.
4. Agent replies `hello_ack` with session config: filters, redaction rules, enabled event streams, command limits.
5. Extension starts streaming activity events.

Each command validates `method` and `params`. `tabId` resolves from `active`, numeric id, or last controlled tab.

## Commands

Core commands:

- `navigate`: background calls `chrome.tabs.update` with URL.
- `inspect`: with no selector returns current picker target/active element; with `selector` returns element details.
- `inspect:start`: enables overlay/picker in content script.
- `inspect:stop`: removes overlay/listeners.
- `query DOM`: selector query; returns matched elements.
- `click`: selector or coordinates; validates visible/clickable; dispatches pointer/mouse events.
- `type`: selector + text; focuses element, uses native setter, dispatches input/change.
- `scroll`: scroll page or element.
- `screenshot`: visible tab capture, optional crop to element bounds.
- `network:deep:start`: attach debugger to tab and enable CDP Network domain.
- `network:deep:stop`: detach debugger.
- `network:getResponseBody`: fetch response body for request id in deep mode.

Error format:

```json
{
  "id": "cmd_9",
  "type": "response",
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "No element matches selector",
    "details": { "selector": "#submit" }
  }
}
```

## Inspect UX

`inspect:start` activates page overlay. Hover sends `inspect:hover` events. Click while picker active sends `inspect:select`; extension can prevent page click. `inspect` returns selected element or targeted `selector` details.

Element serialization includes:

- CSS selector
- XPath fallback
- tag/id/classes/role/aria-label
- text snippet
- allowlisted attributes
- bounding box
- computed style subset
- visibility/clickability flags
- frame path when possible

## Network Inspection

Hybrid model.

Default network capture uses `chrome.webRequest`:

- listens to `onBeforeRequest`, `onBeforeSendHeaders`, `onHeadersReceived`, `onCompleted`, `onErrorOccurred`
- correlates by `requestId`
- streams `network:request`, `network:response`, `network:complete`, `network:error`
- captures URL, method, resource type, `tabId`, frameId, status, timing, request headers, response headers
- no request/response body by default

Deep network capture uses `chrome.debugger` attach opt-in:

- `network:deep:start` attaches DevTools Protocol to target `tabId`
- enables `Network.enable`
- streams `Network.requestWillBeSent`, `Network.responseReceived`, `Network.loadingFinished`, `Network.loadingFailed`
- `network:getResponseBody` calls `Network.getResponseBody`
- `network:deep:stop` detaches
- UI shows debugger attached state because Chrome displays warning

Network event example:

```json
{
  "type": "event",
  "event": "network:response",
  "tabId": 123,
  "payload": {
    "requestId": "abc",
    "url": "https://api.example.com/users",
    "method": "GET",
    "status": 200,
    "type": "xmlhttprequest",
    "responseHeaders": [{ "name": "content-type", "value": "application/json" }],
    "timestamp": 1710000000
  }
}
```

Privacy/security:

- default connect target only `ws://localhost:<port>`
- optional token in `hello`
- no arbitrary JS eval v1
- content script exposes only whitelisted operations
- redact `authorization`, `cookie`, `set-cookie` by default
- body access disabled until explicit deep command
- body size limit, truncate and mark `truncated: true`
- URL/domain filters configured by `hello_ack`

## Testing

Test layers:

- protocol unit tests: request validation, response/error envelopes, `method`/`params` schema checks
- content-script DOM tests: selector generation, inspect serialization, click/type behavior, picker start/stop
- background tests: tab resolution, command routing, reconnect/backoff, timeout handling
- network tests: webRequest correlation and header redaction; debugger mode mocked for CDP events/body fetch
- integration tests: local WebSocket agent sends `navigate`, `inspect:start`, `inspect`, `network:deep:start`, receives expected events
