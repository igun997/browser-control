import { describe, it, expect } from 'vitest';
import {
  TabTarget,
  AgentRequest,
  AgentResponse,
  AgentEvent,
  ProtocolError,
  HelloMessage,
  HelloAckMessage,
  parseAgentMessage,
  resolveTabTarget,
  toProtocolError,
} from './protocol.js';
import { BrowserControlsError } from './errors.js';

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

describe('parseAgentMessage', () => {
  describe('parsing requests', () => {
    it('should parse valid request with id, type, method, params', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        method: 'navigate',
        params: { url: 'https://example.com' },
      };
      const result = parseAgentMessage(message);
      expect(result).toEqual(message);
      const req = result as AgentRequest;
      expect(req.id).toBe('req-1');
      expect(req.method).toBe('navigate');
      expect(req.params).toEqual({ url: 'https://example.com' });
    });

    it('should parse request with empty params', () => {
      const message = {
        id: 'req-2',
        type: 'request',
        method: 'screenshot',
        params: {},
      };
      const result = parseAgentMessage(message);
      expect(result).toEqual(message);
    });
  });

  describe('rejecting missing method', () => {
    it('should throw for request missing method', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        params: { url: 'https://example.com' },
      };
      expect(() => parseAgentMessage(message)).toThrow('Missing method');
    });

    it('should throw for request with undefined method', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        method: undefined,
        params: {},
      };
      expect(() => parseAgentMessage(message)).toThrow('Missing method');
    });

    it('should throw for request with non-string method', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        method: 123,
        params: {},
      };
      expect(() => parseAgentMessage(message)).toThrow('Missing method');
    });
  });

  describe('rejecting invalid params', () => {
    it('should throw for request with non-object params', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        method: 'navigate',
        params: 'not an object',
      };
      expect(() => parseAgentMessage(message)).toThrow('Invalid params');
    });

    it('should throw for request with null params', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        method: 'navigate',
        params: null,
      };
      expect(() => parseAgentMessage(message)).toThrow('Invalid params');
    });

    it('should throw for request with array params', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        method: 'navigate',
        params: ['array', 'not', 'object'],
      };
      expect(() => parseAgentMessage(message)).toThrow('Invalid params');
    });

    it('should throw for request missing params entirely', () => {
      const message = {
        id: 'req-1',
        type: 'request',
        method: 'navigate',
      };
      expect(() => parseAgentMessage(message)).toThrow('Invalid params');
    });
  });

  describe('parsing hello_ack', () => {
    it('should parse valid hello_ack message', () => {
      const message = {
        type: 'hello_ack',
        sessionId: 'session-123',
      };
      const result = parseAgentMessage(message);
      expect(result).toEqual(message);
      const ack = result as HelloAckMessage;
      expect(ack.sessionId).toBe('session-123');
    });

    it('should parse hello_ack with config', () => {
      const message = {
        type: 'hello_ack',
        sessionId: 'session-456',
        config: {
          network: {
            enabled: true,
            urlAllowlist: ['https://example.com'],
          },
          redactHeaders: ['Authorization'],
          bodyLimitBytes: 1000000,
        },
      };
      const result = parseAgentMessage(message);
      expect(result).toEqual(message);
    });
  });
});

describe('resolveTabTarget', () => {
  describe('resolving active', () => {
    it('should return activeTabId when target is "active"', () => {
      const result = resolveTabTarget('active', 42);
      expect(result).toBe(42);
    });

    it('should throw when target is "active" but activeTabId is undefined', () => {
      expect(() => resolveTabTarget('active', undefined)).toThrow('No active tab available');
    });
  });

  describe('resolving numeric', () => {
    it('should return the tab ID when target is a positive number', () => {
      const result = resolveTabTarget(123, 42);
      expect(result).toBe(123);
    });

    it('should return 1 for valid tab ID 1', () => {
      const result = resolveTabTarget(1, 42);
      expect(result).toBe(1);
    });
  });

  describe('rejecting invalid targets', () => {
    it('should throw for zero', () => {
      expect(() => resolveTabTarget(0, 42)).toThrow('Invalid tab target');
    });

    it('should throw for negative numbers', () => {
      expect(() => resolveTabTarget(-1, 42)).toThrow('Invalid tab target');
    });

    it('should throw for non-integer numbers', () => {
      expect(() => resolveTabTarget(1.5, 42)).toThrow('Invalid tab target');
    });

    it('should throw for strings other than "active"', () => {
      expect(() => resolveTabTarget('tab-1' as unknown as TabTarget, 42)).toThrow('Invalid tab target');
    });

    it('should throw for null', () => {
      expect(() => resolveTabTarget(null as unknown as TabTarget, 42)).toThrow('Invalid tab target');
    });

    it('should throw for undefined', () => {
      expect(() => resolveTabTarget(undefined as unknown as TabTarget, 42)).toThrow('Invalid tab target');
    });
  });
});

describe('toProtocolError', () => {
  it('should convert Error with code and message', () => {
    const error = { code: 'ERR_TEST', message: 'Test error', details: { foo: 'bar' } };
    const result = toProtocolError(error);
    expect(result).toEqual({ code: 'ERR_TEST', message: 'Test error', details: { foo: 'bar' } });
  });

  it('should convert plain Error', () => {
    const error = new Error('Something went wrong');
    const result = toProtocolError(error);
    expect(result).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' });
  });

  it('should convert string error', () => {
    const result = toProtocolError('Unknown error');
    expect(result).toEqual({ code: 'UNKNOWN_ERROR', message: 'Unknown error' });
  });

  it('should convert null to unknown error', () => {
    const result = toProtocolError(null);
    expect(result.code).toBe('UNKNOWN_ERROR');
    expect(result.message).toBe('null');
  });

  it('should preserve existing details if provided', () => {
    const error = { code: 'ERR_001', message: 'Bad request', details: { field: 'url' } };
    const result = toProtocolError(error);
    expect(result.details).toEqual({ field: 'url' });
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

describe('Type exports', () => {
  it('should export AgentRequest type', () => {
    const request: AgentRequest = {
      id: 'test-1',
      type: 'request',
      method: 'test',
      params: {},
    };
    expect(request.type).toBe('request');
  });

  it('should export AgentResponse type', () => {
    const response: AgentResponse = {
      id: 'test-1',
      type: 'response',
      result: { success: true },
    };
    expect(response.type).toBe('response');
  });

  it('should export AgentEvent type', () => {
    const event: AgentEvent = {
      type: 'event',
      event: 'tabUpdated',
      tabId: 42,
      payload: {},
    };
    expect(event.type).toBe('event');
  });

  it('should export HelloMessage type', () => {
    const hello: HelloMessage = {
      type: 'hello',
      version: '1.0',
      permissions: ['read', 'write'],
      tabs: [{ id: 1, url: 'https://example.com', title: 'Example', active: true }],
      token: 'abc123',
    };
    expect(hello.type).toBe('hello');
  });

  it('should export HelloAckMessage type', () => {
    const ack: HelloAckMessage = {
      type: 'hello_ack',
      sessionId: 'session-xyz',
    };
    expect(ack.type).toBe('hello_ack');
  });
});