import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { initPopup, type StorageArea } from './main.js';

// Mock chrome API
interface MockStorage {
  get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

function createMockStorage(initialData?: Record<string, unknown>) {
  const data = initialData ?? {};
  const storage: MockStorage = {
    get: vi.fn((keys: string | string[] | null) => {
      const result: Record<string, unknown> = {};
      const keyArray = Array.isArray(keys) ? keys : keys ? [keys] : Object.keys(data);
      for (const key of keyArray) {
        if (key in data) {
          result[key] = data[key];
        }
      }
      return Promise.resolve(result);
    }),
    set: vi.fn((items: Record<string, unknown>) => {
      Object.assign(data, items);
      return Promise.resolve();
    }),
  };
  return { storage, data };
}

function createMockChrome(storage: MockStorage) {
  return {
    storage: {
      sync: storage,
    },
    runtime: {
      sendMessage: vi.fn(() => Promise.resolve({})),
    },
  };
}

describe('initPopup', () => {
  let mockStorage: MockStorage;
  let mockData: Record<string, unknown>;
  let mockChrome: ReturnType<typeof createMockChrome>;

  beforeEach(() => {
    const mock = createMockStorage();
    mockStorage = mock.storage;
    mockData = mock.data;
    mockChrome = createMockChrome(mockStorage);

    // Mock document elements
    document.body.innerHTML = `
      <input id="ws-url" type="text" />
      <input id="token" type="text" />
      <button id="save">Save</button>
      <button id="inspect-start">Start Inspect</button>
      <button id="inspect-stop">Stop Inspect</button>
      <div id="status"></div>
    `;

    vi.stubGlobal('chrome', mockChrome);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads default wsUrl when storage is empty', async () => {
    initPopup(mockChrome.storage);

    // Wait for async load
    await new Promise(resolve => setTimeout(resolve, 10));

    const wsUrlInput = document.querySelector('#ws-url') as HTMLInputElement;
    expect(wsUrlInput.value).toBe('ws://localhost:8765');
  });

  it('loads saved wsUrl and token from storage', async () => {
    // Mutate data in place so the storage.get sees it
    mockData.wsUrl = 'ws://custom:9999';
    mockData.token = 'my-secret-token';

    initPopup(mockChrome.storage);

    await new Promise(resolve => setTimeout(resolve, 10));

    const wsUrlInput = document.querySelector('#ws-url') as HTMLInputElement;
    const tokenInput = document.querySelector('#token') as HTMLInputElement;

    expect(wsUrlInput.value).toBe('ws://custom:9999');
    expect(tokenInput.value).toBe('my-secret-token');
  });

  it('saves wsUrl and token to storage when save button is clicked', async () => {
    initPopup(mockChrome.storage);

    await new Promise(resolve => setTimeout(resolve, 10));

    const wsUrlInput = document.querySelector('#ws-url') as HTMLInputElement;
    const tokenInput = document.querySelector('#token') as HTMLInputElement;
    const saveButton = document.querySelector('#save') as HTMLButtonElement;

    wsUrlInput.value = 'ws://new-server:1234';
    tokenInput.value = 'new-token';

    saveButton.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockStorage.set).toHaveBeenCalledWith({
      wsUrl: 'ws://new-server:1234',
      token: 'new-token',
    });
  });

  it('displays saved status message after save', async () => {
    initPopup(mockChrome.storage);

    await new Promise(resolve => setTimeout(resolve, 10));

    const saveButton = document.querySelector('#save') as HTMLButtonElement;
    const statusDiv = document.querySelector('#status') as HTMLDivElement;

    saveButton.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(statusDiv.textContent).toBe('Saved. Reload extension to reconnect.');
  });

  it('sends popup:inspect:start message when inspect-start button is clicked', async () => {
    initPopup(mockChrome.storage);

    await new Promise(resolve => setTimeout(resolve, 10));

    const inspectStartButton = document.querySelector('#inspect-start') as HTMLButtonElement;
    inspectStartButton.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      method: 'popup:inspect:start',
    });
  });

  it('sends popup:inspect:stop message when inspect-stop button is clicked', async () => {
    initPopup(mockChrome.storage);

    await new Promise(resolve => setTimeout(resolve, 10));

    const inspectStopButton = document.querySelector('#inspect-stop') as HTMLButtonElement;
    inspectStopButton.click();

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(mockChrome.runtime.sendMessage).toHaveBeenCalledWith({
      method: 'popup:inspect:stop',
    });
  });

  it('accepts custom storage object', () => {
    const customStorage = {
      get: vi.fn(() => Promise.resolve({})),
      set: vi.fn(() => Promise.resolve()),
    };

    initPopup({ sync: customStorage } as unknown as StorageArea);

    expect(customStorage.get).toHaveBeenCalled();
  });
});