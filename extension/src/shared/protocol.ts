export type ActionType = 'navigate' | 'scroll' | 'click' | 'input' | 'screenshot' | 'evaluate';
export type TabTarget = 'active' | number;

export interface NavigatePayload {
  url: string;
  waitUntil?: string;
}

export interface ScrollPayload {
  direction: 'up' | 'down' | 'left' | 'right';
  amount?: number;
}

export interface ClickPayload {
  selector: string;
}

export interface InputPayload {
  selector: string;
  text: string;
}

export interface ScreenshotPayload {
  fullPage?: boolean;
}

export interface EvaluatePayload {
  script: string;
}

export type ActionPayload = NavigatePayload | ScrollPayload | ClickPayload | InputPayload | ScreenshotPayload | EvaluatePayload;

export interface BrowserMessage {
  action: ActionType;
  target: TabTarget;
  payload: ActionPayload;
}

const VALID_ACTION_TYPES = new Set<ActionType>([
  'navigate',
  'scroll',
  'click',
  'input',
  'screenshot',
  'evaluate',
]);

export function isValidActionType(action: unknown): action is ActionType {
  return typeof action === 'string' && VALID_ACTION_TYPES.has(action as ActionType);
}

export function isValidTabTarget(target: unknown): target is TabTarget {
  if (target === 'active') return true;
  if (typeof target === 'number' && Number.isInteger(target) && target > 0) return true;
  return false;
}

export function isValidBrowserMessage(message: unknown): message is BrowserMessage {
  if (typeof message !== 'object' || message === null) return false;
  const msg = message as Record<string, unknown>;
  
  if (!isValidActionType(msg.action)) return false;
  if (!isValidTabTarget(msg.target)) return false;
  if (typeof msg.payload !== 'object' || msg.payload === null) return false;
  
  return true;
}