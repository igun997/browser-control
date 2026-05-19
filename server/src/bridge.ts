import type { CommandSender } from './types.js';

/** MCP tool name → extension protocol method */
export const METHOD_MAP: Record<string, string> = {
  navigate: 'navigate',
  inspect: 'inspect',
  inspect_start: 'inspect:start',
  inspect_stop: 'inspect:stop',
  query_dom: 'query DOM',
  click: 'click',
  type: 'type',
  scroll: 'scroll',
  screenshot: 'screenshot',
  network_deep_start: 'network:deep:start',
  network_deep_stop: 'network:deep:stop',
  network_get_response_body: 'network:getResponseBody',
};

export class Bridge {
  constructor(private readonly sender: CommandSender) {}

  async call(toolName: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const method = METHOD_MAP[toolName];
    if (!method) {
      throw new Error(`Unknown tool: ${toolName}`);
    }

    if (!this.sender.isConnected()) {
      throw new Error('Extension not connected');
    }

    return this.sender.send(method, params, timeoutMs);
  }
}
