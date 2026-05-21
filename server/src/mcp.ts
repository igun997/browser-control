import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Bridge } from './bridge.js';

const optionalTabId = z.number().int().positive().optional().describe('Target tab ID. Omit for active tab.');

export const TOOL_DEFINITIONS = [
  {
    name: 'navigate',
    description: 'Navigate a browser tab to a URL',
    inputSchema: z.object({
      url: z.string().url().describe('URL to navigate to (http/https)'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'inspect',
    description: 'Get detailed info about a DOM element by CSS selector',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'inspect_start',
    description: 'Start interactive DOM picker mode — user clicks an element to inspect it',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'inspect_stop',
    description: 'Stop interactive DOM picker mode',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'query_dom',
    description: 'Query DOM elements matching a CSS selector, returns array of element summaries',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'click',
    description: 'Click a DOM element by CSS selector',
    inputSchema: z.object({
      selector: z.string().describe('CSS selector of element to click'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'type',
    description: 'Type text into a DOM element (input, textarea, contenteditable)',
    inputSchema: z.object({
      selector: z.string().optional().describe('CSS selector of input element'),
      text: z.string().describe('Text to type'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'scroll',
    description: 'Scroll the page or a specific element',
    inputSchema: z.object({
      x: z.number().optional().describe('Horizontal scroll pixels'),
      y: z.number().optional().describe('Vertical scroll pixels'),
      selector: z.string().optional().describe('CSS selector of element to scroll'),
      tabId: optionalTabId,
    }),
  },
  {
    name: 'screenshot',
    description: 'Capture a screenshot of the visible tab area, returns base64 PNG data URL',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'network_deep_start',
    description: 'Start deep network capture via Chrome DevTools Protocol (CDP) — captures request/response bodies',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'network_deep_stop',
    description: 'Stop deep network capture',
    inputSchema: z.object({
      tabId: optionalTabId,
    }),
  },
  {
    name: 'network_get_response_body',
    description: 'Get the response body of a captured network request by requestId',
    inputSchema: z.object({
      requestId: z.string().describe('Network request ID from a captured request event'),
      tabId: optionalTabId,
    }),
  },
] as const;

// Google Places review resources
const GOOGLE_REVIEW_PLACES = [
  {
    name: 'Javapixa',
    placeId: 'ChIJwUARo85rei4RSZlO6D6f77A',
  },
] as const;

const GOOGLE_REVIEW_WIDGET_TEMPLATE = 'https://www.google.com/maps/api/js/ReviewsService.LoadWriteWidget?hl=id&key=AIzaSyBcv0QfUNUfBwo8pIGJ3teNCkaluSGUWus&authuser=0&entryPoint=1&placeid={PLACE_ID}&cb=85237367';

function buildReviewUrl(placeId: string): string {
  return GOOGLE_REVIEW_WIDGET_TEMPLATE.replace('{PLACE_ID}', placeId);
}

export function createMcpServer(bridge: Bridge): McpServer {
  const server = new McpServer({
    name: 'browser-controls',
    version: '0.1.0',
  });

  // Register Google review resources
  server.registerResource(
    'google-review-guide',
    'guide://google-review/how-to',
    {
      description: 'How to automate Google reviews using browser-controls',
    },
    async () => ({
      contents: [{
        uri: 'guide://google-review/how-to',
        mimeType: 'text/markdown',
        text: `# Google Review Automation Guide

## Method
Navigate to the review widget URL directly. Replace \`{PLACE_ID}\` with target place ID.

## Widget URL Template
\`\`\`
${GOOGLE_REVIEW_WIDGET_TEMPLATE}
\`\`\`

## Steps
1. Navigate to widget URL with target place ID
2. Wait for page load — stars and textbox render directly (no iframe issues)
3. Click star rating (1-5 stars)
4. Type review text in textarea
5. Click submit button

## Known Places
${GOOGLE_REVIEW_PLACES.map(p => `- **${p.name}**: \`${p.placeId}\` → ${buildReviewUrl(p.placeId)}`).join('\n')}

## Important
- Use UI interactions only — do NOT replay network POST requests
- Stars, textbox, submit are DOM-accessible when opened directly
- authuser=0 means first logged-in Google account in browser
`,
      }],
    }),
  );

  server.registerResource(
    'google-review-places',
    'data://google-review/places',
    {
      description: 'Known Google Place IDs for review automation',
    },
    async () => ({
      contents: [{
        uri: 'data://google-review/places',
        mimeType: 'application/json',
        text: JSON.stringify(
          GOOGLE_REVIEW_PLACES.map(p => ({
            ...p,
            reviewUrl: buildReviewUrl(p.placeId),
          })),
          null,
          2,
        ),
      }],
    }),
  );

  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (params: Record<string, unknown>) => {
        try {
          const result = await bridge.call(tool.name, params as Record<string, unknown>);

          // Screenshot returns base64 data URL — use image content type
          if (tool.name === 'screenshot' && typeof result === 'object' && result !== null) {
            const r = result as { dataUrl?: string; tabId?: number };
            if (r.dataUrl && typeof r.dataUrl === 'string') {
              const match = r.dataUrl.match(/^data:image\/png;base64,(.+)$/);
              if (match?.[1]) {
                return {
                  content: [
                    { type: 'image' as const, data: match[1], mimeType: 'image/png' },
                    { type: 'text' as const, text: `Screenshot captured (tab ${r.tabId ?? 'active'})` },
                  ],
                };
              }
            }
          }

          return {
            content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            content: [{ type: 'text' as const, text: `Error: ${message}` }],
            isError: true,
          };
        }
      },
    );
  }

  return server;
}
