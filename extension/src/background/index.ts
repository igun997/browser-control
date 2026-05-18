import { createAgentSocket, getAgentSocket, AgentSocket } from './wsClient.js';
import { CommandRouter } from './commandRouter.js';

// Initialize the WebSocket connection with default settings
const agentSocket = createAgentSocket();

// Create command router
const commandRouter = new CommandRouter();

// Register request handler that routes to command router
agentSocket.onRequest(async (request) => {
  return commandRouter.handle(request);
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

// Establish the WebSocket connection
void agentSocket.connect();

// Export for use by other modules
export { agentSocket, getAgentSocket, AgentSocket, commandRouter };