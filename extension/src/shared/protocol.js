export function parseAgentMessage(value) {
    if (typeof value !== 'object' || value === null) {
        throw new Error('Invalid message format');
    }
    const msg = value;
    // Check if it's a hello_ack message
    if (msg.type === 'hello_ack') {
        if (typeof msg.sessionId !== 'string') {
            throw new Error('Invalid hello_ack: missing sessionId');
        }
        return msg;
    }
    // Validate request object structure
    if (typeof msg.id !== 'string') {
        throw new Error('Missing id');
    }
    if (msg.type !== 'request') {
        throw new Error('Invalid message type');
    }
    if (typeof msg.method !== 'string') {
        throw new Error('Missing method');
    }
    if (typeof msg.params !== 'object' || msg.params === null || Array.isArray(msg.params)) {
        throw new Error('Invalid params');
    }
    return msg;
}
export function resolveTabTarget(target, activeTabId) {
    if (target === 'active') {
        if (activeTabId === undefined) {
            throw new Error('No active tab available');
        }
        return activeTabId;
    }
    if (typeof target === 'number' && Number.isInteger(target) && target > 0) {
        return target;
    }
    throw new Error('Invalid tab target');
}
export function toProtocolError(error) {
    if (typeof error === 'object' && error !== null) {
        const e = error;
        if (typeof e.code === 'string' && typeof e.message === 'string') {
            return { code: e.code, message: e.message, details: e.details };
        }
    }
    if (error instanceof Error) {
        return { code: 'INTERNAL_ERROR', message: error.message };
    }
    return { code: 'UNKNOWN_ERROR', message: String(error) };
}
