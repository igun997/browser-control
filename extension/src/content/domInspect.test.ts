import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeSelector, inspectSelector, inspectElement, setupInspectHandler } from './domInspect.js';
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

describe('inspectSelector', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should find element by id selector', () => {
    document.body.appendChild(createElement('div', { id: 'test-id' }));
    const el = inspectSelector('#test-id');
    expect(el).toBeTruthy();
    expect(el!.id).toBe('test-id');
  });

  it('should find element by class selector', () => {
    document.body.appendChild(createElement('div', { className: 'test-class' }));
    const el = inspectSelector('div.test-class');
    expect(el).toBeTruthy();
    expect(el!.className).toBe('test-class');
  });

  it('should find element by nth-child selector', () => {
    const parent = createElement('ul');
    parent.appendChild(createElement('li'));
    parent.appendChild(createElement('li'));
    parent.appendChild(createElement('li'));
    document.body.appendChild(parent);

    const el = inspectSelector('li:nth-child(2)');
    expect(el).toBeTruthy();
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

  it('should throw BrowserControlsError when selector matches no elements', () => {
    document.body.appendChild(createElement('div', { className: 'other' }));
    expect(() => inspectSelector('div.nonexistent-class')).toThrow(BrowserControlsError);
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

  it('should register message listener', () => {
    const addEventListenerSpy = vi.fn();
    vi.stubGlobal('window', {
      addEventListener: addEventListenerSpy,
      // Mock chrome.runtime for the sendMessage fallback
      chrome: { runtime: { sendMessage: vi.fn() } },
    });

    setupInspectHandler();

    expect(addEventListenerSpy).toHaveBeenCalledWith('message', expect.any(Function));
  });

  it('should respond to inspect request with result', async () => {
    const sendMessageMock = vi.fn();
    let messageHandler: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: (_event: string, listener: (event: MessageEvent) => void) => {
        messageHandler = listener;
      },
    });

    setupInspectHandler({ sendMessage: sendMessageMock });

    // Setup DOM for inspection
    document.body.innerHTML = '<div id="inspectable"><span>Test content</span></div>';

    // Create mock event with source = window
    const mockEvent = {
      source: window,
      data: JSON.stringify({
        method: 'inspect',
        params: { selector: '#inspectable' },
      }),
    } as unknown as MessageEvent;

    await messageHandler!(mockEvent);

    expect(sendMessageMock).toHaveBeenCalledWith(
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

  it('should respond with error for ELEMENT_NOT_FOUND', async () => {
    const sendMessageMock = vi.fn();
    let messageHandler: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: (_event: string, listener: (event: MessageEvent) => void) => {
        messageHandler = listener;
      },
    });

    setupInspectHandler({ sendMessage: sendMessageMock });

    const mockEvent = {
      source: window,
      data: JSON.stringify({
        method: 'inspect',
        params: { selector: '#does-not-exist' },
      }),
    } as unknown as MessageEvent;

    await messageHandler!(mockEvent);

    expect(sendMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ok: false,
        error: expect.objectContaining({
          code: 'ELEMENT_NOT_FOUND',
          message: 'No element matches selector',
        }),
      })
    );
  });

  it('should ignore non-inspect method messages', async () => {
    const sendMessageMock = vi.fn();
    let messageHandler: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: (_event: string, listener: (event: MessageEvent) => void) => {
        messageHandler = listener;
      },
    });

    setupInspectHandler({ sendMessage: sendMessageMock });

    const mockEvent = {
      source: window,
      data: JSON.stringify({
        method: 'navigate',
        params: { url: 'https://example.com' },
      }),
    } as unknown as MessageEvent;

    await messageHandler!(mockEvent);

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('should ignore messages from other sources', async () => {
    const sendMessageMock = vi.fn();
    let messageHandler: ((event: MessageEvent) => void) | null = null;

    vi.stubGlobal('window', {
      addEventListener: (_event: string, listener: (event: MessageEvent) => void) => {
        messageHandler = listener;
      },
    });

    setupInspectHandler({ sendMessage: sendMessageMock });

    // Create an iframe-like source (different from window)
    const otherWindow = {};
    const mockEvent = {
      source: otherWindow,
      data: JSON.stringify({
        method: 'inspect',
        params: { selector: '#anything' },
      }),
    } as unknown as MessageEvent;

    await messageHandler!(mockEvent);

    expect(sendMessageMock).not.toHaveBeenCalled();
  });
});