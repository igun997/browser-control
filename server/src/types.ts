export interface CommandSender {
  send(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
  isConnected(): boolean;
  close(): void;
}
