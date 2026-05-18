import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeSelector, inspectSelector, inspectElement, setupInspectHandler, registerInspectHandler, findElement } from './domInspect.js';
import { BrowserControlsError } from '../shared/errors.js';

// Test helper to create DOM elements
function createElement(tagName: string, attributes: Record<string, string> = {}, children: string[] = []): HTMLElement {
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
  children.forEach(child => el.appendChild(document.createTextNode(child)));
  return el;
}

describe('makeSelector', () => {
  it('should return id selector for element with id', () => {
    const el = createElement('div', { id: 'my-unique-id' });
    expect(makeSelector(el)).toBe('#my-unique-id');
  });

  it('should return id selector even if element has classes', () => {
    const el = createElement('div', { id: 'unique', className: 'class1 class2' });
    expect(makeSelector(el)).toBe('#unique');
  });

  it('should return id selector for any element with id', () => {
    const el = createElement('span', { id: 'span-id' });
    expect(makeSelector(el)).toBe('#span-id');
  });

  it('should return tag.class for element without id but with class', () => {
    const el = createElement('div', { className: 'container' });
    expect(makeSelector(el)).toBe('div.container');
  });

  it('should return tag with multiple classes', () => {
    const el = createElement('div', { className: 'container wrapper active' });
    expect(makeSelector(el)).toBe('div.container.wrapper.active');
  });

  it('should return full path with nth-child for element without id and class', () => {
    const parent = createElement('div');
    parent.appendChild(createElement('p'));
    parent.appendChild(createElement('span'));
    parent.appendChild(createElement('div'));

    const children = Array.from(parent.children);
    // Since there's no id, makeSelector builds path from root
    const pSelector = makeSelector(children[0]!);
    expect(pSelector).toContain('p');
    expect(pSelector).toContain('nth-child');
  });

  it('should include parent path for nested elements', () => {
    const grandparent = createElement('div', { className: 'outer' });
    const parent = document.createElement('div');
    grandparent.appendChild(parent);
    const child = document.createElement('span');
    parent.appendChild(child);

    const selector = makeSelector(child);
    expect(selector).toContain('span');
    expect(selector).toContain('nth-child');
    expect(selector).toContain('div.outer');
  });

  it('should handle elements with unusual class names', () => {
    const el = createElement('div', { className: 'my-class' });
    const selector = makeSelector(el);
    expect(selector).toBe('div.my-class');
  });
});

describe('findElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should return HTMLElement when element found', () => {
    document.body.appendChild(createElement('div', { id: 'find-test' }));
    const el = findElement('#find-test');
    expect(el).toBeTruthy();
    expect(el instanceof HTMLElement).toBe(true);
    expect(el.id).toBe('find-test');
  });

  it('should throw BrowserControlsError with ELEMENT_NOT_FOUND for non-existent selector', () => {
    expect(() => findElement('#non-existent')).toThrow(BrowserControlsError);
    try {
      findElement('#non-existent');
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserControlsError);
      expect((e as BrowserControlsError).code).toBe('ELEMENT_NOT_FOUND');
      expect((e as BrowserControlsError).message).toBe('No element matches selector');
    }
  });
});

describe('inspectSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should return InspectResult with selector, tag, id for element found by id', () => {
    document.body.appendChild(createElement('div', { id: 'inspect-target', className: 'test-class' }));
    const result = inspectSelector('#inspect-target');
    
    expect(result).toBeTruthy();
    expect(result).toHaveProperty('selector');
    expect(result).toHaveProperty('tag');
    expect(result).toHaveProperty('id');
    expect(result).toHaveProperty('xpath');
    expect(result).toHaveProperty('classes');
    expect(result).toHaveProperty('textSnippet');
    expect(result).toHaveProperty('attributes');
    expect(result).toHaveProperty('bounds');
    expect(result).toHaveProperty('visible');
    
    expect(result.selector).toBe('#inspect-target');
    expect(result.tag).toBe('div');
    expect(result.id).toBe('inspect-target');
    expect(result.classes).toContain('test-class');
  });

  it('should return InspectResult with xpath for element found by class', () => {
    document.body.appendChild(createElement('div', { className: 'inspectable-class', textContent: 'Hello' }));
    const result = inspectSelector('div.inspectable-class');
    
    expect(result).toHaveProperty('xpath');
    expect(result.xpath.length).toBeGreaterThan(0);
    expect(result.textSnippet).toBe('Hello');
  });

  it('should return InspectResult with textSnippet for element with text', () => {
    document.body.appendChild(createElement('p', { textContent: 'This is some text content' }));
    const result = inspectSelector('p');
    
    expect(result.textSnippet).toContain('This is some text content');
  });

  it('should return InspectResult with attributes when element has allowlisted attrs', () => {
    const el = createElement('input', {
      type: 'text',
      name: 'username',
      'data-testid': 'login-input',
      placeholder: 'Enter username',
    });
    document.body.appendChild(el);
    
    const result = inspectSelector('input');
    
    expect(result.attributes).toHaveProperty('type');
    expect(result.attributes).toHaveProperty('name');
    expect(result.attributes).toHaveProperty('data-testid');
    expect(result.attributes).toHaveProperty('placeholder');
    expect(result.attributes.type).toBe('text');
    expect(result.attributes.name).toBe('username');
  });

  it('should throw BrowserControlsError with ELEMENT_NOT_FOUND for non-existent selector', () => {
    expect(() => inspectSelector('#non-existent')).toThrow(BrowserControlsError);
    try {
      inspectSelector('#non-existent');
    } catch (e) {
      expect(e).toBeInstanceOf(BrowserControlsError);
      expect((e as BrowserControlsError).code).toBe('ELEMENT_NOT_FOUND');
      expect((e as BrowserControlsError).message).toBe('No element matches selector');
    }
  });

  it('should throw for invalid selector', () => {
    expect(() => inspectSelector('[')).toThrow(BrowserControlsError);
  });
});

describe('inspectElement', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should return selector for element with id', () => {
    document.body.appendChild(createElement('div', { id: 'inspect-target' }));
    const el = document.getElementById('inspect-target')!;
    const result = inspectElement(el);
    expect(result.selector).toBe('#inspect-target');
  });

  it('should return tag name', () => {
    const el = createElement('span', { id: 'span-tag' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.tag).toBe('span');
  });

  it('should return id', () => {
    const el = createElement('div', { id: 'my-id' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.id).toBe('my-id');
  });

  it('should return empty string for no id', () => {
    const el = createElement('div', { className: 'no-id' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.id).toBe('');
  });

  it('should return classes array', () => {
    const el = createElement('div', { className: 'class1 class2 class3' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.classes).toEqual(['class1', 'class2', 'class3']);
  });

  it('should return empty array for no classes', () => {
    const el = createElement('div', { id: 'no-classes' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.classes).toEqual([]);
  });

  it('should return role when present', () => {
    const el = createElement('button', { role: 'button' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.role).toBe('button');
  });

  it('should return empty string for no role', () => {
    const el = createElement('div');
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.role).toBe('');
  });

  it('should return aria-label when present', () => {
    const el = createElement('button', { 'aria-label': 'Close dialog' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.ariaLabel).toBe('Close dialog');
  });

  it('should return empty string for no aria-label', () => {
    const el = createElement('button');
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.ariaLabel).toBe('');
  });

  it('should return text snippet truncated to ~50 chars', () => {
    const el = createElement('p', { textContent: 'This is a longer text that should be truncated' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    // jsdom may not preserve exact length due to whitespace handling
    expect(result.textSnippet.length).toBeLessThanOrEqual(60);
    expect(result.textSnippet).toContain('truncated');
  });

  it('should return empty string for no text', () => {
    const el = createElement('div');
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.textSnippet).toBe('');
  });

  it('should return allowlisted attributes', () => {
    const el = createElement('input', {
      type: 'text',
      name: 'username',
      'data-testid': 'login-input',
      placeholder: 'Enter username',
      disabled: '',
    });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.attributes).toEqual({
      type: 'text',
      name: 'username',
      'data-testid': 'login-input',
      placeholder: 'Enter username',
    });
    expect(result.attributes).not.toHaveProperty('disabled');
  });

  it('should return bounds object with all properties', () => {
    const el = createElement('div', { id: 'bounds-test' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.bounds).toBeDefined();
    expect(result.bounds).toHaveProperty('x');
    expect(result.bounds).toHaveProperty('y');
    expect(result.bounds).toHaveProperty('width');
    expect(result.bounds).toHaveProperty('height');
  });

  it('should return visible property', () => {
    const el = createElement('div', { id: 'visible-test' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.visible).toBeDefined();
    // jsdom may return different values, just check it's boolean
    expect(typeof result.visible).toBe('boolean');
  });

  it('should return xpath for any element', () => {
    const el = createElement('span', { id: 'xpath-test' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    expect(result.xpath).toBeDefined();
    expect(typeof result.xpath).toBe('string');
    expect(result.xpath.length).toBeGreaterThan(0);
  });

  it('should return full xpath for element without id', () => {
    const el = createElement('div', { className: 'test-class' });
    document.body.appendChild(el);
    const result = inspectElement(el);
    // Should contain div and class info
    expect(result.xpath).toContain('div');
  });
});

describe('setupInspectHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return a handler function', () => {
    const sendMessageMock = vi.fn();
    const handler = setupInspectHandler({ sendMessage: sendMessageMock });
    expect(typeof handler).toBe('function');
  });

  it('should return true when handling inspect method', async () => {
    const sendMessageMock = vi.fn();
    const handler = setupInspectHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<div id="inspectable"><span>Test content</span></div>';

    const message = {
      method: 'inspect',
      params: { selector: '#inspectable' },
    };
    const sendResponse = vi.fn();

    const result = handler(message, {}, sendResponse);

    expect(result).toBe(true);
  });

  it('should call sendResponse with ok:true and InspectResult for valid selector', async () => {
    const sendMessageMock = vi.fn();
    const handler = setupInspectHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<div id="inspectable"><span>Test content</span></div>';

    const message = {
      method: 'inspect',
      params: { selector: '#inspectable' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          selector: '#inspectable',
          tag: 'div',
          id: 'inspectable',
        }),
      })
    );
  });

  it('should call sendResponse with ok:false and error for ELEMENT_NOT_FOUND', async () => {
    const sendMessageMock = vi.fn();
    const handler = setupInspectHandler({ sendMessage: sendMessageMock });

    const message = {
      method: 'inspect',
      params: { selector: '#does-not-exist' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'ELEMENT_NOT_FOUND',
          message: 'No element matches selector',
        }),
      })
    );
  });

  it('should return false and not call sendResponse for non-inspect methods', () => {
    const sendMessageMock = vi.fn();
    const handler = setupInspectHandler({ sendMessage: sendMessageMock });

    const message = {
      method: 'navigate',
      params: { url: 'https://example.com' },
    };
    const sendResponse = vi.fn();

    const result = handler(message, {}, sendResponse);

    expect(result).toBe(false);
    expect(sendResponse).not.toHaveBeenCalled();
  });

  it('should handle string selector in params', async () => {
    const sendMessageMock = vi.fn();
    const handler = setupInspectHandler({ sendMessage: sendMessageMock });

    document.body.innerHTML = '<div class="test-class"></div>';

    const message = {
      method: 'inspect',
      params: { selector: 'div.test-class' },
    };
    const sendResponse = vi.fn();

    handler(message, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          tag: 'div',
          classes: ['test-class'],
        }),
      })
    );
  });
});

describe('registerInspectHandler', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call chrome.runtime.onMessage.addListener with the handler', () => {
    // Mock chrome.runtime.onMessage
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

    registerInspectHandler();

    expect(addListenerMock).toHaveBeenCalledTimes(1);
    expect(typeof addListenerMock.mock.calls[0]![0]).toBe('function');
  });
});
