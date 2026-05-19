export type TabTarget = 'active' | number;
export interface AgentRequest {
    id: string;
    type: 'request';
    method: string;
    params: Record<string, unknown>;
}
export interface AgentResponse {
    id: string;
    type: 'response';
    result?: unknown;
    error?: ProtocolError;
}
export interface AgentEvent {
    type: 'event';
    event: string;
    tabId?: number | undefined;
    windowId?: number | undefined;
    payload: Record<string, unknown>;
}
export interface ProtocolError {
    code: string;
    message: string;
    details?: unknown;
}
export interface HelloMessage {
    type: 'hello';
    version: string;
    permissions: string[];
    tabs: Array<{
        id: number;
        url?: string;
        title?: string;
        active: boolean;
    }>;
    token?: string;
}
export interface HelloAckMessage {
    type: 'hello_ack';
    sessionId: string;
    config?: {
        network?: {
            enabled?: boolean;
            urlAllowlist?: string[];
            urlBlocklist?: string[];
        };
        redactHeaders?: string[];
        bodyLimitBytes?: number;
    };
}
export declare function parseAgentMessage(value: unknown): AgentRequest | HelloAckMessage;
export declare function resolveTabTarget(target: TabTarget | unknown, activeTabId: number | undefined): number;
export declare function toProtocolError(error: unknown): ProtocolError;
