export interface StorageArea {
  sync: {
    get(keys: string | string[] | null): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
}

/**
 * Initialize the popup UI with WebSocket configuration and inspect controls.
 * @param storage - Chrome storage API (e.g., chrome.storage)
 * @param defaultWsUrl - Default WebSocket URL (default: ws://localhost:8765)
 */
export function initPopup(storage: StorageArea, defaultWsUrl = 'ws://localhost:8765'): void {
  // Get DOM elements
  const wsUrlInput = document.querySelector('#ws-url') as HTMLInputElement;
  const tokenInput = document.querySelector('#token') as HTMLInputElement;
  const saveButton = document.querySelector('#save') as HTMLButtonElement;
  const inspectStartButton = document.querySelector('#inspect-start') as HTMLButtonElement;
  const inspectStopButton = document.querySelector('#inspect-stop') as HTMLButtonElement;
  const statusDiv = document.querySelector('#status') as HTMLDivElement;

  // Load saved configuration
  storage.sync.get(['wsUrl', 'token']).then((items) => {
    wsUrlInput.value = (items.wsUrl as string) || defaultWsUrl;
    tokenInput.value = (items.token as string) || '';
  });

  // Save button handler
  saveButton.addEventListener('click', async () => {
    const wsUrl = wsUrlInput.value.trim() || defaultWsUrl;
    const token = tokenInput.value.trim();

    await storage.sync.set({ wsUrl, token });

    statusDiv.textContent = 'Saved. Reload extension to reconnect.';
  });

  // Inspect start button handler
  inspectStartButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ method: 'popup:inspect:start' });
  });

  // Inspect stop button handler
  inspectStopButton.addEventListener('click', () => {
    chrome.runtime.sendMessage({ method: 'popup:inspect:stop' });
  });
}

// Initialize on DOM ready
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof chrome !== 'undefined' && chrome.storage) {
        initPopup(chrome.storage);
      }
    });
  } else {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      initPopup(chrome.storage);
    }
  }
}