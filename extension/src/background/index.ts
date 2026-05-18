import { createAgentSocket, getAgentSocket, AgentSocket } from './wsClient.js';

// Initialize the WebSocket connection with default settings
const agentSocket = createAgentSocket();

// Register a default request handler
agentSocket.onRequest(async (request) => {
  // Placeholder handler - actual handlers will be registered by commands module
  console.log('Received request:', request.method, request.params);
  return { success: true, message: 'Request received' };
});

// Log connection status
agentSocket.onOpen(() => {
  console.log('Connected to agent WebSocket');
});

agentSocket.onClose(() => {
  console.log('Disconnected from agent WebSocket');
});

agentSocket.onError((error) => {
  console.error('WebSocket error:', error);
});

// Export for use by other modules
export { agentSocket, getAgentSocket, AgentSocket };