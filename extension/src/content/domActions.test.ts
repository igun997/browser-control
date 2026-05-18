import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clickSelector,
  typeIntoSelector,
  scrollTarget,
  setupActionsHandler,
  registerActionsHandler,
} from './domActions.js';
import { BrowserControlsError } from '../shared/errors.js';

// Test helper to create DOM elements
function createElement(
  tagName: string,
  attributes: Record<string, string> = {},
  children: string[] = []
): HTMLElement {
  const el = document.createElement(tagName);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'className') {
      el.className = value;
    } else if (key === 'textContent') {
      el.textContent = value;
    } else {
      el.setAttribute(key, value);
    }
  }
  children.forEach((child) => el.appendChild(document.createTextNode(child)));
  return el;
}

// Helper to make element have scrollIntoView
function makeScrollable(el: HTMLElement): void {
  Object.defineProperty(el, 'scrollIntoView', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

describe('clickSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should click element and return selector with clicked:true', () => {
    const button = createElement('button', { id: 'clickable-btn', type: 'submit' });
    makeScrollable(button);
    document.body.appendChild(button);

    const result = clickSelector('#clickable-btn');

    expect(result).toEqual({ selector: '#clickable-btn', clicked: true });
  });

  it('should scroll element into view before clicking', () => {
    const el = createElement('div', { id: 'scrollable' });
    makeScrollable(el);
    document.body.appendChild(el);

    clickSelector('#scrollable');

    expect(el.scrollIntoView).toHaveBeenCalledWith({ behavior: 'instant', block: 'center', inline: 'center' });
  });

  it('should dispatch events before click', () => {
    const button = createElement('button', { id: 'pointer-btn' });
    makeScrollable(button);
    document.body.appendChild(button);

    const pointerDownSpy = vi.spyOn(button, 'dispatchEvent');
    const clickSpy = vi.spyOn(button, 'click');

    clickSelector('#pointer-btn');

    // Should dispatch pointer events followed by click
    expect(pointerDownSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
  });

  it('should throw ELEMENT_NOT_FOUND for non-existent selector', () => {
    expect(() => clickSelector('#non-existent')).toThrow(BrowserControlsError);
    try {
      clickSelector('#non-existent');
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserControlsError);
      expect((e as BrowserControlsError).code).toBe('ELEMENT_NOT_FOUND');
    }
  });

  it('should work with class selectors', () => {
    const button = createElement('button', { className: 'action-btn primary' });
    makeScrollable(button);
    document.body.appendChild(button);

    const result = clickSelector('button.action-btn');

    expect(result).toEqual({ selector: 'button.action-btn', clicked: true });
  });
});

describe('typeIntoSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should type text into input and return typed:true', () => {
    const input = createElement('input', { type: 'text', name: 'username' });
    document.body.appendChild(input);

    const result = typeIntoSelector('input[name="username"]', 'testuser');

    expect(result).toEqual({ selector: 'input[name="username"]', typed: true });
    expect((input as HTMLInputElement).value).toBe('testuser');
  });

  it('should type into textarea', () => {
    const textarea = createElement('textarea', { name: 'comment' });
    document.body.appendChild(textarea);

    const result = typeIntoSelector('textarea[name="comment"]', 'Hello World');

    expect(result).toEqual({ selector: 'textarea[name="comment"]', typed: true });
    expect((textarea as HTMLTextAreaElement).value).toBe('Hello World');
  });

  it('should focus element before typing', () => {
    const input = createElement('input', { type: 'text' });
    const focusSpy = vi.spyOn(input, 'focus');
    document.body.appendChild(input);

    typeIntoSelector('input', 'hello');

    expect(focusSpy).toHaveBeenCalled();
  });

  it('should dispatch input and change events', () => {
    const input = createElement('input', { type: 'text' });
    const inputSpy = vi.spyOn(input, 'dispatchEvent');
    const changeSpy = vi.spyOn(input, 'dispatchEvent');
    document.body.appendChild(input);

    typeIntoSelector('input', 'new value');

    expect(inputSpy).toHaveBeenCalled();
    expect(changeSpy).toHaveBeenCalled();
  });

  it('should throw INVALID_INPUT_ELEMENT for non-input/textarea elements', () => {
    const div = createElement('div', { id: 'not-input' });
    document.body.appendChild(div);

    expect(() => typeIntoSelector('#not-input', 'text')).toThrow(BrowserControlsError);
    try {
      typeIntoSelector('#not-input', 'text');
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserControlsError);
      expect((e as BrowserControlsError).code).toBe('INVALID_INPUT_ELEMENT');
    }
  });

  it('should throw ELEMENT_NOT_FOUND for non-existent selector', () => {
    expect(() => typeIntoSelector('#non-existent', 'text')).toThrow(BrowserControlsError);
    try {
      typeIntoSelector('#non-existent', 'text');
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserControlsError);
      expect((e as BrowserControlsError).code).toBe('ELEMENT_NOT_FOUND');
    }
  });

  it('should handle empty text', () => {
    const input = createElement('input', { type: 'text' });
    document.body.appendChild(input);

    const result = typeIntoSelector('input', '');

    expect(result).toEqual({ selector: 'input', typed: true });
  });
});

describe('scrollTarget', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should scroll element to position and return scrolled:true', () => {
    const el = createElement('div', { id: 'scroll-target' });
    el.scrollTo = vi.fn();
    document.body.appendChild(el);

    const result = scrollTarget('#scroll-target', 100, 200);

    expect(result).toEqual({ scrolled: true });
    expect(el.scrollTo).toHaveBeenCalledWith(100, 200);
  });

  it('should scroll window when no selector provided', () => {
    const scrollToSpy = vi.spyOn(window, 'scrollTo');

    const result = scrollTarget(undefined, 50, 100);

    expect(result).toEqual({ scrolled: true });
    expect(scrollToSpy).toHaveBeenCalledWith(50, 100);
  });

  it('should throw ELEMENT_NOT_FOUND for non-existent selector', () => {
    expect(() => scrollTarget('#non-existent', 0, 0)).toThrow(BrowserControlsError);
    try {
      scrollTarget('#non-existent', 0, 0);
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserControlsError);
      expect((e as BrowserControlsError).code).toBe('ELEMENT_NOT_FOUND');
    }
  });

  it('should handle element without scrollTo method using scrollLeft/scrollTop', () => {
    const el = createElement('div', { id: 'no-scroll' });
    // Override scrollTo to make it undefined (simulating element without method)
    Object.defineProperty(el, 'scrollTo', {
      value: undefined,
      writable: true,
      configurable: true,
    });
    document.body.appendChild(el);

    const result = scrollTarget('#no-scroll', 50, 75);

    expect(result).toEqual({ scrolled: true });
    expect(el.scrollLeft).toBe(50);
    expect(el.scrollTop).toBe(75);
  });
});

describe('setupActionsHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a handler function', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });
    expect(typeof handler).toBe('function');
  });

  it('should handle click method', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<button id="clickable">Click me</button>';
    const btn = document.getElementById('clickable')!;
    makeScrollable(btn);

    const message = {
      method: 'click',
      params: { selector: '#clickable' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          selector: '#clickable',
          clicked: true,
        }),
      })
    );
  });

  it('should handle type method', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<input type="text" id="input-field" />';

    const message = {
      method: 'type',
      params: { selector: '#input-field', text: 'Hello' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          selector: '#input-field',
          typed: true,
        }),
      })
    );
  });

  it('should handle scroll method with selector', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<div id="scrollable"></div>';
    const el = document.getElementById('scrollable')!;
    el.scrollTo = vi.fn();

    const message = {
      method: 'scroll',
      params: { selector: '#scrollable', x: 10, y: 20 },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: { scrolled: true },
      })
    );
  });

  it('should handle scroll method without selector (window scroll)', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    const message = {
      method: 'scroll',
      params: { x: 100, y: 200 },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: { scrolled: true },
      })
    );
  });

  it('should return false for non-action methods', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    const message = {
      method: 'inspect',
      params: { selector: '#some-element' },
    };
    const sendResponse = vi.fn();

    const result = handler(message, {}, sendResponse);

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('should return error response for ELEMENT_NOT_FOUND', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    const message = {
      method: 'click',
      params: { selector: '#does-not-exist' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'ELEMENT_NOT_FOUND',
        }),
      })
    );
  });

  it('should return error for INVALID_INPUT_ELEMENT', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<div id="not-input">Not an input</div>';

    const message = {
      method: 'type',
      params: { selector: '#not-input', text: 'hello' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'INVALID_INPUT_ELEMENT',
        }),
      })
    );
  });

  it('should return error for missing selector on click', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    const message = {
      method: 'click',
      params: {},
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'INVALID_PARAMS',
          message: 'Missing selector parameter',
        }),
      })
    );
  });

  it('should return error for missing text on type', () => {
    const sendMessageMock = vi.fn();
    const handler = setupActionsHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<input type="text" id="input" />';

    const message = {
      method: 'type',
      params: { selector: '#input' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'INVALID_PARAMS',
          message: 'Missing text parameter',
        }),
      })
    );
  });
});

describe('registerActionsHandler', () => {
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

    registerActionsHandler();

    expect(addListenerMock).toHaveBeenCalledTimes(1);
    expect(typeof addListenerMock.mock.calls[0]![0]).toBe('function');
  });
});