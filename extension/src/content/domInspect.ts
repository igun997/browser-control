import { BrowserControlsError } from '../shared/errors.js';

export interface InspectResult {
  selector: string;
  xpath: string;
  tag: string;
  id: string;
  classes: string[];
  role: string;
  ariaLabel: string;
  textSnippet: string;
  attributes: Record<string, string>;
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
}

// Allowlisted attributes to include in inspection results
const ALLOWLISTED_ATTRIBUTES = [
  'type',
  'name',
  'value',
  'placeholder',
  'title',
  'alt',
  'src',
  'href',
  'data-testid',
  'data-test',
  'data-cy',
];

/**
 * Generate a stable CSS selector for an element.
 * Returns #id if element has an id, otherwise builds a path with tag/classes/nth-child.
 */
export function makeSelector(element: Element): string {
  // If element has an id, use it
  if (element.id) {
    // Sanitize: ensure id is valid CSS selector
    if (/^[a-zA-Z_][\w-]*$/.test(element.id)) {
      return `#${element.id}`;
    }
    // Fallback: include tag name with escaped id
    return `${element.tagName.toLowerCase()}#${CSS.escape(element.id)}`;
  }

  // Build path from element to document root
  const path: string[] = [];
  let current: Element | null = element;

  while (current && current !== document.documentElement && current !== document.body) {
    let selector = current.tagName.toLowerCase();

    // Add classes if available
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).filter(c => c);
      if (classes.length > 0) {
        selector += '.' + classes.slice(0, 3).join('.');
      }
    }

    // Add nth-child if needed to make selector stable
    if (!current.id && (!current.className || !String(current.className).trim())) {
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children);
        const index = siblings.indexOf(current);
        if (index >= 0) {
          selector += `:nth-child(${index + 1})`;
        }
      }
    }

    path.unshift(selector);
    current = current.parentElement;
  }

  return path.join(' > ');
}

/**
 * Get XPath for an element.
 */
function getXPath(element: Element): string {
  if (element.id) {
    return `//*[@id="${element.id}"]`;
  }

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    let index = 1;
    let sibling = current.previousElementSibling;

    while (sibling) {
      if (sibling.tagName === current.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }

    const tagName = current.tagName.toLowerCase();
    parts.unshift(`${tagName}[${index}]`);
    current = current.parentElement;
  }

  return '/' + parts.join('/');
}

/**
 * Check if an element is visible (not display:none, visibility:hidden, or opacity:0).
 */
function isVisible(element: HTMLElement): boolean {
  if (element.offsetWidth === 0 && element.offsetHeight === 0) {
    return false;
  }
  const style = window.getComputedStyle(element);
  if (style.visibility === 'hidden' || style.display === 'none') {
    return false;
  }
  if (parseFloat(style.opacity) === 0) {
    return false;
  }
  return true;
}

/**
 * Find element by CSS selector.
 * @throws BrowserControlsError with code ELEMENT_NOT_FOUND if no element matches
 */
export function inspectSelector(selector: string): HTMLElement | never {
  try {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) {
      throw new BrowserControlsError(
        'ELEMENT_NOT_FOUND',
        'No element matches selector'
      );
    }
    return element;
  } catch (e) {
    if (e instanceof BrowserControlsError) {
      throw e;
    }
    throw new BrowserControlsError(
      'ELEMENT_NOT_FOUND',
      'No element matches selector'
    );
  }
}

/**
 * Inspect an element and return detailed information.
 */
export function inspectElement(element: HTMLElement): InspectResult {
  const rect = element.getBoundingClientRect();

  // Get allowlisted attributes
  const attributes: Record<string, string> = {};
  for (const attr of ALLOWLISTED_ATTRIBUTES) {
    const value = element.getAttribute(attr);
    if (value !== null) {
      attributes[attr] = value;
    }
  }

  // Get text content, truncated to 50 chars
  const textContent = element.textContent?.trim() ?? '';
  const textSnippet = textContent.length > 50
    ? textContent.substring(0, 50) + '...'
    : textContent;

  return {
    selector: makeSelector(element),
    xpath: getXPath(element),
    tag: element.tagName.toLowerCase(),
    id: element.id ?? '',
    classes: element.className
      ? element.className.trim().split(/\s+/).filter(c => c)
      : [],
    role: element.getAttribute('role') ?? '',
    ariaLabel: element.getAttribute('aria-label') ?? '',
    textSnippet,
    attributes,
    bounds: {
      x: Math.round(rect.left + window.scrollX),
      y: Math.round(rect.top + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
    visible: isVisible(element),
  };
}

export interface InspectHandlerOptions {
  sendMessage?: (message: { ok: boolean; result?: InspectResult; error?: { code: string; message: string } }) => void;
}

/**
 * Setup message handler for 'inspect' method.
 * Handles {method:'inspect', params:{selector}} messages and sends back results.
 */
export function setupInspectHandler(options: InspectHandlerOptions = {}): void {
  const sendMessage = options.sendMessage ?? ((message: { ok: boolean; result?: InspectResult; error?: { code: string; message: string } }) => {
    chrome.runtime.sendMessage(message);
  });

  window.addEventListener('message', (event: MessageEvent) => {
    // Only handle our own messages from content script
    if (event.source !== window) return;

    let data: { method: string; params?: { selector?: string } };
    try {
      data = JSON.parse(String(event.data));
    } catch {
      // Invalid JSON - ignore
      return;
    }

    // Only handle inspect method
    if (data.method !== 'inspect') return;

    const selector = data.params?.selector;
    if (!selector) {
      sendMessage({
        ok: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'Missing selector parameter',
        },
      });
      return;
    }

    try {
      const element = inspectSelector(selector);
      const result = inspectElement(element);
      sendMessage({ ok: true, result });
    } catch (error) {
      if (error instanceof BrowserControlsError) {
        sendMessage({
          ok: false,
          error: {
            code: error.code,
            message: error.message,
          },
        });
      } else {
        sendMessage({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  });
}