import { createAgentSocket, getAgentSocket, AgentSocket } from './wsClient.js';
import { CommandRouter } from './commandRouter.js';
import { NetworkInspector } from './networkInspector.js';
import { DeepNetworkInspector } from './deepNetworkInspector.js';
import type { SocketOptions } from './wsClient.js';

// Module-level state for exported instances
let agentSocket: AgentSocket | null = null;
let commandRouter: CommandRouter | null = null;
let networkInspector: NetworkInspector | null = null;
let deepNetworkInspector: DeepNetworkInspector | null = null;

// Load configuration from storage
async function loadConfig(): Promise<{ wsUrl: string; token?: string }> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['wsUrl', 'token'], (items) => {
      const result: { wsUrl: string; token?: string } = {
        wsUrl: (items.wsUrl as string) || 'ws://localhost:8765',
      };
      if (items.token) {
        result.token = items.token as string;
      }
      resolve(result);
    });
  });
}

// Initialize the WebSocket connection with configured settings
async function initializeSocket(): Promise<void> {
  const config = await loadConfig();

  // Create socket options with explicit token handling
  const socketOptions: SocketOptions = {
    url: config.wsUrl,
  };
  if (config.token !== undefined) {
    socketOptions.token = config.token;
  }

  // Create agent socket with loaded configuration
  agentSocket = createAgentSocket(socketOptions);

  // Create command router
  commandRouter = new CommandRouter();

  // Create deep network inspector and hook it up to emit events via the socket
  deepNetworkInspector = new DeepNetworkInspector((event) => {
    agentSocket!.sendEvent(event.event, { ...event.payload, tabId: event.tabId });
  });

  // Wire up deep network inspector to command router
  commandRouter.setDeepNetworkInspector(deepNetworkInspector);

  // Create basic network inspector and hook it up to emit events via the socket
  networkInspector = new NetworkInspector((event: string, payload: Record<string, unknown>) => {
    agentSocket!.sendEvent(event, payload);
  });

  // Register request handler that routes to command router
  agentSocket.onRequest(async (request) => {
    return commandRouter!.handle(request);
  });

  // Log connection status
  agentSocket.onOpen(() => {
    console.log('Connected to agent WebSocket');
    // Attach network inspector to start monitoring requests
    networkInspector!.attach();
  });

  agentSocket.onClose(() => {
    console.log('Disconnected from agent WebSocket');
  });

  agentSocket.onError((error) => {
    console.error('WebSocket error:', error);
  });

  // Register Chrome debugger event listener for deep network events
  // This bridges CDP events from chrome.debugger to the deep network inspector
  const debuggerEventListener = (
    source: { tabId?: number },
    method: string,
    params?: unknown
  ) => {
    deepNetworkInspector!.handleEvent(source, method, params);
  };

  chrome.debugger.onEvent.addListener(
    debuggerEventListener as (source: chrome.debugger.DebuggerSession, method: string, params?: object | undefined) => void
  );

  // Establish the WebSocket connection
  void agentSocket.connect();
}

// Handle popup messages for inspect controls
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.method === 'popup:inspect:start') {
    if (!commandRouter) {
      sendResponse({ ok: false, error: 'ROUTER_UNAVAILABLE' });
      return true;
    }

    void commandRouter
      .handle({
        id: 'popup',
        type: 'request',
        method: 'inspect:start',
        params: { tabId: 'active' },
      })
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((err) => {
        const error = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error });
      });

    return true;
  }

  if (message.method === 'popup:inspect:stop') {
    if (!commandRouter) {
      sendResponse({ ok: false, error: 'ROUTER_UNAVAILABLE' });
      return true;
    }

    void commandRouter
      .handle({
        id: 'popup',
        type: 'request',
        method: 'inspect:stop',
        params: { tabId: 'active' },
      })
      .then((result) => {
        sendResponse({ ok: true, result });
      })
      .catch((err) => {
        const error = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, error });
      });

    return true;
  }

  return false;
});

// Export for use by other modules
export {
  getAgentSocket,
  agentSocket,
  commandRouter,
  networkInspector,
  deepNetworkInspector,
};

// Initialize on startup
void initializeSocket();