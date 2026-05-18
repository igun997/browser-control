import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InspectPicker, setupPickerHandler, registerPickerHandler, createPickerEmitter } from './inspectPicker.js';
import { inspectElement } from './domInspect.js';

// Test helper to create DOM elements
function createElement(
  tagName: string,
  attributes: Record<string, string> = {}
): HTMLElement {
  const el = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') {
      el.className = value;
    } else {
      el.setAttribute(key, value);
    }
  }
  return el;
}

describe('InspectPicker', () => {
  let emitEvents: Array<{ event: string; payload: unknown }>;

  beforeEach(() => {
    document.body.innerHTML = '';
    emitEvents = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should accept emit function', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      expect(picker).toBeDefined();
    });
  });

  describe('start', () => {
    it('should add mousemove and click listeners', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);

      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

      const result = picker.start();

      expect(addEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), true);
      expect(addEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
      expect(result).toEqual({ active: true });
    });

    it('should return {active:true} when already active (idempotent)', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);

      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

      picker.start();
      picker.start();

      // Only 2 calls (one for each listener) - second start shouldn't add more
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2);

      // Third start - should still not add more
      picker.start();
      expect(addEventListenerSpy).toHaveBeenCalledTimes(2);
    });

    it('should emit inspect:hover when mousemove occurs over element', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const target = createElement('div', { id: 'hover-target' });
      document.body.appendChild(target);

      const mousemoveEvent = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(mousemoveEvent, 'target', { value: target });
      
      document.dispatchEvent(mousemoveEvent);

      expect(emit).toHaveBeenCalledWith('inspect:hover', expect.objectContaining({
        selector: '#hover-target',
        tag: 'div',
        id: 'hover-target',
      }));
    });

    it('should not emit when mousemove is over window/document', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const mousemoveEvent = new MouseEvent('mousemove', { bubbles: true });
      document.dispatchEvent(mousemoveEvent);

      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('stop', () => {
    it('should remove mousemove and click listeners', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const result = picker.stop();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function), true);
      expect(removeEventListenerSpy).toHaveBeenCalledWith('click', expect.any(Function), true);
      expect(result).toEqual({ active: false });
    });

    it('should be safe to call stop without start', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);

      const result = picker.stop();

      expect(result).toEqual({ active: false });
    });

    it('should stop emitting after stop() is called', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const target = createElement('div', { id: 'target' });
      document.body.appendChild(target);

      picker.stop();

      const mousemoveEvent = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(mousemoveEvent, 'target', { value: target });
      document.dispatchEvent(mousemoveEvent);

      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('click behavior', () => {
    it('should emit inspect:select with inspectElement payload on click', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const target = createElement('button', { id: 'select-btn', className: 'primary' });
      document.body.appendChild(target);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', { value: target });
      
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');

      document.dispatchEvent(clickEvent);

      expect(emit).toHaveBeenCalledWith('inspect:select', expect.objectContaining({
        selector: '#select-btn',
        tag: 'button',
        id: 'select-btn',
        classes: ['primary'],
      }));
      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should prevent default and stop propagation on click', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const target = createElement('a', { href: 'https://example.com' });
      document.body.appendChild(target);

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      const preventDefaultSpy = vi.spyOn(clickEvent, 'preventDefault');
      const stopPropagationSpy = vi.spyOn(clickEvent, 'stopPropagation');
      Object.defineProperty(clickEvent, 'target', { value: target });

      document.dispatchEvent(clickEvent);

      expect(preventDefaultSpy).toHaveBeenCalled();
      expect(stopPropagationSpy).toHaveBeenCalled();
    });

    it('should not emit inspect:select after stop() is called', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const target = createElement('div', { id: 'target' });
      document.body.appendChild(target);

      picker.stop();

      const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
      Object.defineProperty(clickEvent, 'target', { value: target });
      document.dispatchEvent(clickEvent);

      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('event payload structure', () => {
    it('should include all inspectElement properties in payload', () => {
      const emit = vi.fn();
      const picker = new InspectPicker(emit);
      picker.start();

      const target = createElement('button', { id: 'full-inspect', role: 'button', 'aria-label': 'Close' });
      document.body.appendChild(target);

      const mousemoveEvent = new MouseEvent('mousemove', { bubbles: true });
      Object.defineProperty(mousemoveEvent, 'target', { value: target });
      document.dispatchEvent(mousemoveEvent);

      expect(emit).toHaveBeenCalledWith('inspect:hover', expect.objectContaining({
        selector: '#full-inspect',
        xpath: expect.any(String),
        tag: 'button',
        id: 'full-inspect',
        classes: [],
        role: 'button',
        ariaLabel: 'Close',
        textSnippet: expect.any(String),
        attributes: expect.any(Object),
        bounds: expect.any(Object),
        visible: expect.any(Boolean),
      }));
    });
  });
});

describe('createPickerEmitter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should create a function', () => {
    const emitter = createPickerEmitter();
    expect(typeof emitter).toBe('function');
  });
});

describe('setupPickerHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a handler function', () => {
    const emit = vi.fn();
    const handler = setupPickerHandler(emit);
    expect(typeof handler).toBe('function');
  });

  it('should return true when handling inspect:start method', () => {
    const sendMessageMock = vi.fn();
    const handler = setupPickerHandler(vi.fn(), { sendMessage: sendMessageMock });

    document.body.innerHTML = '<div id="test"></div>';
    const target = document.getElementById('test')!;

    const sendResponse = vi.fn();
    const result = handler({ method: 'inspect:start' }, {}, sendResponse);

    expect(result).toBe(true);
  });

  it('should return true when handling inspect:stop method', () => {
    const sendMessageMock = vi.fn();
    const handler = setupPickerHandler(vi.fn(), { sendMessage: sendMessageMock });

    const sendResponse = vi.fn();
    const result = handler({ method: 'inspect:stop' }, {}, sendResponse);

    expect(result).toBe(true);
  });

  it('should call sendResponse with ok:true and {active:true} for inspect:start', () => {
    const sendMessageMock = vi.fn();
    const handler = setupPickerHandler(vi.fn(), { sendMessage: sendMessageMock });

    const sendResponse = vi.fn();
    handler({ method: 'inspect:start' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: { active: true },
      })
    );
  });

  it('should call sendResponse with ok:true and {active:false} for inspect:stop', () => {
    const sendMessageMock = vi.fn();
    const handler = setupPickerHandler(vi.fn(), { sendMessage: sendMessageMock });

    const sendResponse = vi.fn();
    handler({ method: 'inspect:stop' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: { active: false },
      })
    );
  });

  it('should return false for non-picker methods', () => {
    const sendMessageMock = vi.fn();
    const handler = setupPickerHandler(vi.fn(), { sendMessage: sendMessageMock });

    const message = { method: 'click', params: { selector: '#btn' } };
    const sendResponse = vi.fn();

    const result = handler(message, {}, sendResponse);

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('should not interfere with inspect method (returns false for non-picker methods)', () => {
    const sendMessageMock = vi.fn();
    const handler = setupPickerHandler(vi.fn(), { sendMessage: sendMessageMock });

    const message = { method: 'inspect', params: { selector: '#btn' } };
    const sendResponse = vi.fn();

    const result = handler(message, {}, sendResponse);

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });
});

describe('registerPickerHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call chrome.runtime.onMessage.addListener', () => {
    const addListenerMock = vi.fn();
    const globalMock = {
      chrome: {
        runtime: {
          onMessage: {
            addListener: addListenerMock,
          },
        },
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as unknown as { chrome?: typeof globalMock.chrome }).chrome = globalMock.chrome;

    registerPickerHandler();

    expect(addListenerMock).toHaveBeenCalledTimes(1);
    expect(typeof addListenerMock.mock.calls[0]![0]).toBe('function');
  });
});