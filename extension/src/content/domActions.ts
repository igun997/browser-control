import { BrowserControlsError } from '../shared/errors.js';
import { findElement } from './domInspect.js';

/**
 * Dispatch a mouse event (fallback for jsdom PointerEvent issues).
 */
function dispatchMouseEvent(
  element: HTMLElement,
  type: string,
  options: { bubbles?: boolean; cancelable?: boolean } = {}
): void {
  const event = new MouseEvent(type, {
    bubbles: options.bubbles ?? true,
    cancelable: options.cancelable ?? true,
  });
  element.dispatchEvent(event);
}

/**
 * Click an element by CSS selector.
 * Scrolls element into view, dispatches pointer events, and clicks.
 * @throws BrowserControlsError with code ELEMENT_NOT_FOUND if no element matches
 */
export function clickSelector(selector: string): { selector: string; clicked: true } | never {
  const element = findElement(selector);

  // Scroll into view center (with fallback for jsdom)
  if (typeof element.scrollIntoView === 'function') {
    element.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  }

  // Dispatch pointer events before clicking
  // Use MouseEvent as fallback since PointerEvent may not work in jsdom
  if (typeof PointerEvent === 'undefined') {
    dispatchMouseEvent(element, 'pointerdown', { bubbles: true, cancelable: true });
    dispatchMouseEvent(element, 'pointerup', { bubbles: true, cancelable: true });
  } else {
    try {
      const pointerDownEvent = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(pointerDownEvent);

      const pointerUpEvent = new PointerEvent('pointerup', {
        bubbles: true,
        cancelable: true,
      });
      element.dispatchEvent(pointerUpEvent);
    } catch {
      // Fallback to MouseEvent if PointerEvent fails
      dispatchMouseEvent(element, 'pointerdown', { bubbles: true, cancelable: true });
      dispatchMouseEvent(element, 'pointerup', { bubbles: true, cancelable: true });
    }
  }

  // Dispatch click event
  element.click();

  return { selector, clicked: true };
}

/**
 * Type text into an input or textarea element.
 * @throws BrowserControlsError with code ELEMENT_NOT_FOUND if no element matches
 * @throws BrowserControlsError with code INVALID_INPUT_ELEMENT if element is not input/textarea
 */
export function typeIntoSelector(
  selector: string,
  text: string
): { selector: string; typed: true } | never {
  const element = findElement(selector);

  // Check if element is input or textarea
  const tagName = element.tagName.toLowerCase();
  if (tagName !== 'input' && tagName !== 'textarea') {
    throw new BrowserControlsError(
      'INVALID_INPUT_ELEMENT',
      'Element must be an input or textarea'
    );
  }

  // Focus the element
  element.focus();

  // Set value using native setter
  if (tagName === 'textarea') {
    (element as HTMLTextAreaElement).value = text;
  } else {
    (element as HTMLInputElement).value = text;
  }

  // Dispatch input event
  const inputEvent = new Event('input', { bubbles: true, cancelable: true });
  element.dispatchEvent(inputEvent);

  // Dispatch change event
  const changeEvent = new Event('change', { bubbles: true, cancelable: true });
  element.dispatchEvent(changeEvent);

  return { selector, typed: true };
}

/**
 * Scroll an element or window to specified coordinates.
 * @param selector - CSS selector for element to scroll, or undefined for window
 * @param x - Horizontal scroll position
 * @param y - Vertical scroll position
 * @throws BrowserControlsError with code ELEMENT_NOT_FOUND if element not found
 */
export function scrollTarget(
  selector: string | undefined,
  x: number,
  y: number
): { scrolled: true } | never {
  if (selector) {
    const element = findElement(selector);

    // Use scrollTo if available (elements), otherwise use scrollLeft/scrollTop
    if (typeof (element as HTMLElement & { scrollTo?: unknown }).scrollTo === 'function') {
      (element as HTMLElement & { scrollTo: (x: number, y: number) => void }).scrollTo(x, y);
    } else {
      (element as HTMLElement).scrollLeft = x;
      (element as HTMLElement).scrollTop = y;
    }
  } else {
    // Handle jsdom not implementing window.scrollTo
    if (typeof window.scrollTo === 'function') {
      try {
        window.scrollTo(x, y);
      } catch {
        // jsdom may not implement scrollTo, but that's okay
      }
    }
  }

  return { scrolled: true };
}

// Response types for actions
interface ClickResult {
  selector: string;
  clicked: true;
}

interface TypeResult {
  selector: string;
  typed: true;
}

interface ScrollResult {
  scrolled: true;
}

export type ActionResult = ClickResult | TypeResult | ScrollResult;

export interface ActionsHandlerOptions {
  sendMessage?: (message: { ok: boolean; result?: ActionResult; error?: { code: string; message: string } }) => void;
}

/**
 * Setup message handler for action methods (click, type, scroll).
 * Handles messages with method: 'click'|'type'|'scroll' and params.
 * Returns a handler function compatible with chrome.runtime.onMessage.
 */
export function setupActionsHandler(
  options: ActionsHandlerOptions = {}
): (
  message: object,
  _sender: object,
  sendResponse: (response?: { ok: boolean; result?: ActionResult; error?: { code: string; message: string } }) => void
) => boolean {
  const sendMessage =
    options.sendMessage ??
    ((message: { ok: boolean; result?: ActionResult; error?: { code: string; message: string } }) => {
      chrome.runtime.sendMessage(message);
    });

  return (
    message: object,
    _sender: object,
    sendResponse: (response?: { ok: boolean; result?: ActionResult; error?: { code: string; message: string } }) => void
  ): boolean => {
    const data = message as { method: string; params?: { selector?: string; text?: string; x?: number; y?: number } };

    // Handle click method
    if (data.method === 'click') {
      const selector = data.params?.selector;
      if (!selector) {
        sendResponse({
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Missing selector parameter',
          },
        });
        return true;
      }

      try {
        const result = clickSelector(String(selector));
        sendResponse({ ok: true, result });
      } catch (error) {
        if (error instanceof BrowserControlsError) {
          sendResponse({
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          });
        } else {
          sendResponse({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
      return true;
    }

    // Handle type method
    if (data.method === 'type') {
      const selector = data.params?.selector;
      const text = data.params?.text;

      if (!selector) {
        sendResponse({
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Missing selector parameter',
          },
        });
        return true;
      }

      if (text === undefined || text === null) {
        sendResponse({
          ok: false,
          error: {
            code: 'INVALID_PARAMS',
            message: 'Missing text parameter',
          },
        });
        return true;
      }

      try {
        const result = typeIntoSelector(String(selector), String(text));
        sendResponse({ ok: true, result });
      } catch (error) {
        if (error instanceof BrowserControlsError) {
          sendResponse({
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          });
        } else {
          sendResponse({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
      return true;
    }

    // Handle scroll method
    if (data.method === 'scroll') {
      const selector = data.params?.selector;
      const x = data.params?.x ?? 0;
      const y = data.params?.y ?? 0;

      try {
        const result = scrollTarget(selector, x, y);
        sendResponse({ ok: true, result });
      } catch (error) {
        if (error instanceof BrowserControlsError) {
          sendResponse({
            ok: false,
            error: {
              code: error.code,
              message: error.message,
            },
          });
        } else {
          sendResponse({
            ok: false,
            error: {
              code: 'INTERNAL_ERROR',
              message: error instanceof Error ? error.message : String(error),
            },
          });
        }
      }
      return true;
    }

    // Not an action method - return false to let other handlers process
    return false;
  };
}

/**
 * Register the actions handler with chrome.runtime.onMessage.
 */
export function registerActionsHandler(options: ActionsHandlerOptions = {}): void {
  chrome.runtime.onMessage.addListener(setupActionsHandler(options));
}