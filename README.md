# Browser Controls

A Chrome extension that exposes browser automation commands via WebSocket, enabling AI agents to control a Chrome browser session programmatically.

## Commands

| Command | Description | Parameters |
|---------|-------------|------------|
| `navigate` | Navigate to a URL | `url` (string, required), `tabId` (number or 'active', optional) |
| `inspect` | Get element info at coordinates | `xpath` (string), `tabId` (optional) |
| `inspect:start` | Start DOM inspection mode | `tabId` (optional) |
| `inspect:stop` | Stop DOM inspection mode | `tabId` (optional) |
| `query DOM` | Query DOM elements using CSS selector or XPath | `selector` (string, required), `tabId` (optional) |
| `click` | Click an element | `selector` (string, required), `tabId` (optional) |
| `type` | Type text into an element | `selector` (string, required), `text` (string, required), `tabId` (optional) |
| `scroll` | Scroll an element into view | `selector` (string, optional), `direction` ('up'/'down', optional), `tabId` (optional) |
| `screenshot` | Capture visible tab screenshot | Returns data URL |
| `network:deep:start` | Start deep network monitoring | `tabId` (optional) |
| `network:getResponseBody` | Get response body for a request | `requestId` (string, required), `tabId` (optional) |
| `network:deep:stop` | Stop deep network monitoring | `tabId` (optional) |

## Protocol

Communication uses JSON messages over WebSocket.

### Message Format

**Request:**
```json
{
  "id": "unique-request-id",
  "type": "request",
  "method": "command-name",
  "params": { /* command parameters */ },
  "tabId": 123  // optional: target specific tab
}
```

**Response:**
```json
{
  "id": "unique-request-id",
  "type": "response",
  "result": { /* response data */ }
}
```

**Error:**
```json
{
  "id": "unique-request-id",
  "type": "response",
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### Handshake

1. Agent sends `hello` message with version and permissions
2. Extension responds with `hello_ack` containing session ID

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Type check
npm run typecheck

# Build for production
npm run build
```

### Loading the Extension

1. Run `npm run build`
2. Open Chrome and navigate to `chrome://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the `dist` directory
5. Click the extension icon in Chrome to activate the popup
6. The extension will start a WebSocket server on the configured port

## Architecture

- **Background Script**: WebSocket server, command routing, network inspection
- **Content Script**: DOM manipulation, element inspection, user interactions
- **Popup**: UI for connection status and quick actions