import { describe, it, expect } from 'vitest';
import {
  ActionType,
  BrowserMessage,
  isValidActionType,
  isValidTabTarget,
  isValidBrowserMessage,
  TabTarget,
} from './protocol.js';
import { BrowserControlsError } from './errors.js';

describe('ActionType', () => {
  it('should be a union of valid action types', () => {
    const validActions: ActionType[] = [
      'navigate',
      'scroll',
      'click',
      'input',
      'screenshot',
      'evaluate',
    ];
    validActions.forEach((action) => {
      expect(typeof action).toBe('string');
    });
  });
});

describe('TabTarget', () => {
  it('should accept active keyword', () => {
    const target: TabTarget = 'active';
    expect(target).toBe('active');
  });

  it('should accept numeric tab IDs', () => {
    const target: TabTarget = 123;
    expect(target).toBe(123);
  });
});

describe('isValidActionType', () => {
  it('should return true for valid action types', () => {
    expect(isValidActionType('navigate')).toBe(true);
    expect(isValidActionType('scroll')).toBe(true);
    expect(isValidActionType('click')).toBe(true);
    expect(isValidActionType('input')).toBe(true);
    expect(isValidActionType('screenshot')).toBe(true);
    expect(isValidActionType('evaluate')).toBe(true);
  });

  it('should return false for invalid action types', () => {
    expect(isValidActionType('invalid')).toBe(false);
    expect(isValidActionType('')).toBe(false);
    expect(isValidActionType('NAVIGATE')).toBe(false);
  });
});

describe('isValidTabTarget', () => {
  it('should return true for active keyword', () => {
    expect(isValidTabTarget('active')).toBe(true);
  });

  it('should return true for positive numeric tab IDs', () => {
    expect(isValidTabTarget(1)).toBe(true);
    expect(isValidTabTarget(123)).toBe(true);
    expect(isValidTabTarget(999999)).toBe(true);
  });

  it('should return false for invalid values', () => {
    expect(isValidTabTarget(0)).toBe(false);
    expect(isValidTabTarget(-1)).toBe(false);
    expect(isValidTabTarget(NaN)).toBe(false);
  });
});

describe('isValidBrowserMessage', () => {
  it('should return true for valid navigate message', () => {
    const message: BrowserMessage = {
      action: 'navigate',
      target: 'active',
      payload: { url: 'https://example.com' },
    };
    expect(isValidBrowserMessage(message)).toBe(true);
  });

  it('should return true for valid scroll message', () => {
    const message: BrowserMessage = {
      action: 'scroll',
      target: 1,
      payload: { direction: 'down', amount: 100 },
    };
    expect(isValidBrowserMessage(message)).toBe(true);
  });

  it('should return true for valid click message', () => {
    const message: BrowserMessage = {
      action: 'click',
      target: 'active',
      payload: { selector: '#button' },
    };
    expect(isValidBrowserMessage(message)).toBe(true);
  });

  it('should return true for valid screenshot message', () => {
    const message: BrowserMessage = {
      action: 'screenshot',
      target: 1,
      payload: {},
    };
    expect(isValidBrowserMessage(message)).toBe(true);
  });

  it('should return false for missing action', () => {
    const message = {
      target: 'active',
      payload: { url: 'https://example.com' },
    } as unknown as BrowserMessage;
    expect(isValidBrowserMessage(message)).toBe(false);
  });

  it('should return false for invalid action type', () => {
    const message = {
      action: 'jump',
      target: 'active',
      payload: {},
    } as unknown as BrowserMessage;
    expect(isValidBrowserMessage(message)).toBe(false);
  });

  it('should return false for invalid target', () => {
    const message = {
      action: 'navigate',
      target: -1,
      payload: { url: 'https://example.com' },
    } as unknown as BrowserMessage;
    expect(isValidBrowserMessage(message)).toBe(false);
  });
});

describe('BrowserControlsError', () => {
  it('should have code, message, and optional details', () => {
    const error = new BrowserControlsError('ERR_001', 'Test error', { foo: 'bar' });
    expect(error.code).toBe('ERR_001');
    expect(error.message).toBe('Test error');
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(BrowserControlsError);
  });

  it('should work without details', () => {
    const error = new BrowserControlsError('ERR_002', 'Simple error');
    expect(error.code).toBe('ERR_002');
    expect(error.message).toBe('Simple error');
    expect(error.details).toBeUndefined();
  });
});