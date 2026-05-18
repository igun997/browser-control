import { inspectElement, InspectResult } from './domInspect.js';

/**
 * InspectPicker provides element inspection functionality via mouse interactions.
 * When active, it listens for mousemove (hover preview) and click (element selection).
 */
export class InspectPicker {
  private active = false;
  private emit: (event: string, payload: InspectResult) => void;
  private readonly onMouseMove: (event: MouseEvent) => void;
  private readonly onClick: (event: MouseEvent) => void;

  /**
   * Create a new InspectPicker.
   * @param emit - Function to call when picker events occur: emit(event, payload)
   */
  constructor(emit: (event: string, payload: InspectResult) => void) {
    this.emit = emit;
    
    this.onMouseMove = (event: MouseEvent): void => {
      const target = event.target;
      // Skip if target is not an HTMLElement (e.g., document, window, text nodes)
      if (!target || !(target instanceof HTMLElement)) {
        return;
      }
      this.emit('inspect:hover', inspectElement(target));
    };

    this.onClick = (event: MouseEvent): void => {
      const target = event.target;
      // Skip if target is not an HTMLElement (e.g., document, window, text nodes)
      if (!target || !(target instanceof HTMLElement)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.emit('inspect:select', inspectElement(target));
    };
  }

  /**
   * Start the picker - adds event listeners for mousemove and click.
   * Idempotent: calling start() multiple times has no additional effect.
   * @returns {active: true} indicating the picker is now active
   */
  start(): { active: true } {
    if (this.active) {
      return { active: true };
    }
    document.addEventListener('mousemove', this.onMouseMove, true);
    document.addEventListener('click', this.onClick, true);
    this.active = true;
    return { active: true };
  }

  /**
   * Stop the picker - removes event listeners.
   * Safe to call even if the picker was not started.
   * @returns {active: false} indicating the picker is no longer active
   */
  stop(): { active: false } {
    if (!this.active) {
      return { active: false };
    }
    document.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('click', this.onClick, true);
    this.active = false;
    return { active: false };
  }
}

export interface PickerHandlerOptions {
  sendMessage?: (message: { ok: boolean; result?: { active: boolean }; error?: { code: string; message: string } }) => void;
}

/**
 * Create a message handler for picker commands (inspect:start, inspect:stop).
 * Returns a handler function compatible with chrome.runtime.onMessage.
 */
export function setupPickerHandler(
  emit: (event: string, payload: InspectResult) => void,
  options: PickerHandlerOptions = {}
): (
  message: object,
  _sender: object,
  sendResponse: (response?: { ok: boolean; result?: { active: boolean }; error?: { code: string; message: string } }) => void
) => boolean {
  const picker = new InspectPicker(emit);
  
  const sendMessage =
    options.sendMessage ??
    ((message: { ok: boolean; result?: { active: boolean }; error?: { code: string; message: string } }) => {
      chrome.runtime.sendMessage(message);
    });

  return (
    message: object,
    _sender: object,
    sendResponse: (response?: { ok: boolean; result?: { active: boolean }; error?: { code: string; message: string } }) => void
  ): boolean => {
    const data = message as { method: string };

    if (data.method === 'inspect:start') {
      const result = picker.start();
      sendResponse({ ok: true, result });
      return true;
    }

    if (data.method === 'inspect:stop') {
      const result = picker.stop();
      sendResponse({ ok: true, result });
      return true;
    }

    // Not a picker method - return false to let other handlers process
    return false;
  };
}

/**
 * Create an emit function that sends picker events via chrome.runtime.sendMessage.
 */
export function createPickerEmitter(): (event: string, payload: InspectResult) => void {
  return (event: string, payload: InspectResult): void => {
    chrome.runtime.sendMessage({
      type: 'event',
      event,
      payload,
    });
  };
}

/**
 * Register the picker handler with chrome.runtime.onMessage.
 * Creates a single shared InspectPicker instance for all commands.
 */
export function registerPickerHandler(options: PickerHandlerOptions = {}): void {
  const emit = createPickerEmitter();
  const handler = setupPickerHandler(emit, options);
  chrome.runtime.onMessage.addListener(handler);
}