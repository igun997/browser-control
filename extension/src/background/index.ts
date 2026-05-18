import { createAgentSocket, getAgentSocket, AgentSocket } from './wsClient.js';
import { CommandRouter } from './commandRouter.js';
import { NetworkInspector } from './networkInspector.js';
import { DeepNetworkInspector } from './deepNetworkInspector.js';

// Initialize the WebSocket connection with default settings
const agentSocket = createAgentSocket();

// Create command router
const commandRouter = new CommandRouter();

// Create deep network inspector and hook it up to emit events via the socket
const deepNetworkInspector = new DeepNetworkInspector((event) => {
  agentSocket.sendEvent(event.event, { ...event.payload, tabId: event.tabId });
});

// Wire up deep network inspector to command router
commandRouter.setDeepNetworkInspector(deepNetworkInspector);

// Create basic network inspector and hook it up to emit events via the socket
const networkInspector = new NetworkInspector((event: string, payload: Record<string, unknown>) => {
  agentSocket.sendEvent(event, payload);
});

// Register request handler that routes to command router
agentSocket.onRequest(async (request) => {
  return commandRouter.handle(request);
});

// Log connection status
agentSocket.onOpen(() => {
  console.log('Connected to agent WebSocket');
  // Attach network inspector to start monitoring requests
  networkInspector.attach();
});

agentSocket.onClose(() => {
  console.log('Disconnected from agent WebSocket');
});

agentSocket.onError((error) => {
  console.error('WebSocket error:', error);
});

// Register Chrome debugger event listener for deep network events
// This bridges CDP events from chrome.debugger to the deep network inspector
// Cast the listener to match the internal interface (params is unknown in internal, but object in chrome)
const debuggerEventListener = (
  source: { tabId?: number },
  method: string,
  params?: unknown
) => {
  deepNetworkInspector.handleEvent(source, method, params);
};

chrome.debugger.onEvent.addListener(
  debuggerEventListener as (source: chrome.debugger.DebuggerSession, method: string, params?: object | undefined) => void
);

// Establish the WebSocket connection
void agentSocket.connect();

// Export for use by other modules
export {
  agentSocket,
  getAgentSocket,
  AgentSocket,
  commandRouter,
  networkInspector,
  deepNetworkInspector,
};