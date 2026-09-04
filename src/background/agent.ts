import { AgentClient } from '../shared/agentClient';
import type {
  BundleSummary,
  CaptureParams,
  CaptureResult,
  InspectPageParams,
  InspectPageResult,
  ListTabsParams,
  ListTabsResult,
  OpenStudioParams,
  OpenStudioResult,
  TabInfo,
  WaitForCaptureParams,
  WaitForCaptureResult,
} from '../shared/agentProtocol';
import { AGENT_INJECTION_KEY } from '../shared/types';
import type {
  AgentCaptureMessage,
  CaptureBundle,
  InspectMessage,
  PickerStateMessage,
  PickerStateResponse,
} from '../shared/types';
import { openOrFocusStudio } from './studioTab';

let clientInstance: AgentClient | null = null;

interface PendingWait {
  resolve: (bundle: CaptureBundle) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pendingBundleWaits: PendingWait[] = [];

export function summarize(bundle: CaptureBundle): BundleSummary {
  const bgLayer = bundle.layers.find((l) => l.role === 'background');
  const docW = bundle.raster?.document?.width ?? (bgLayer ? bgLayer.rect.w : bundle.viewport.width);
  const docH = bundle.raster?.document?.height ?? (bgLayer ? bgLayer.rect.h : bundle.viewport.height);
  const layerCount = bundle.layers.filter((l) => l.role === 'zap').length;

  return {
    url: bundle.source.url,
    title: bundle.source.title,
    capturedAt: bundle.source.capturedAt,
    viewport: {
      width: bundle.viewport.width,
      height: bundle.viewport.height,
      dpr: bundle.viewport.dpr,
      scrollX: bundle.viewport.scrollX ?? 0,
      scrollY: bundle.viewport.scrollY ?? 0,
    },
    document: {
      width: docW,
      height: docH,
    },
    layerCount,
    brief: bundle.intent?.brief,
    frameFormat: bundle.intent?.frameFormat,
  };
}

export function notifyBundle(bundle: CaptureBundle): void {
  const summary = summarize(bundle);
  if (clientInstance) {
    clientInstance.emit('bundle', summary);
  }

  while (pendingBundleWaits.length > 0) {
    const waiter = pendingBundleWaits.shift()!;
    clearTimeout(waiter.timer);
    waiter.resolve(bundle);
  }
}

export function waitForNextBundle(timeoutMs: number): Promise<CaptureBundle> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = pendingBundleWaits.findIndex((w) => w.timer === timer);
      if (idx >= 0) pendingBundleWaits.splice(idx, 1);
      reject(new Error(`waitForNextBundle timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    pendingBundleWaits.push({ resolve, reject, timer });
  });
}

export function sendToTab<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message || 'chrome.tabs.sendMessage failed'));
      } else {
        resolve(response as T);
      }
    });
  });
}

export async function ensureContentScript(tabId: number): Promise<void> {
  try {
    const msg: PickerStateMessage = { type: 'DIORAMA_PICKER_STATE' };
    await sendToTab(tabId, msg);
    return;
  } catch {
    // Content script not ready or not injected
  }

  // Set injection key so content script doesn't open overlay automatically
  await chrome.storage.local.set({ [AGENT_INJECTION_KEY]: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });

  await new Promise((resolve) => setTimeout(resolve, 150));

  try {
    const msg: PickerStateMessage = { type: 'DIORAMA_PICKER_STATE' };
    await sendToTab(tabId, msg);
  } catch (err) {
    throw new Error(`Failed to ensure content script on tab ${tabId}: ${String(err)}`);
  }
}

async function resolveHttpTab(tabId?: number): Promise<{ tabId: number; tab: chrome.tabs.Tab }> {
  let targetId = tabId;
  let targetTab: chrome.tabs.Tab | undefined;

  if (targetId !== undefined) {
    targetTab = await chrome.tabs.get(targetId);
  } else {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    targetTab = tabs[0];
    targetId = targetTab?.id;
  }

  if (!targetTab || !targetId || !targetTab.url) {
    throw new Error('Onglet introuvable');
  }

  if (!targetTab.url.startsWith('http://') && !targetTab.url.startsWith('https://')) {
    throw new Error(`L'URL de l'onglet n'est pas http(s): ${targetTab.url}`);
  }

  return { tabId: targetId, tab: targetTab };
}

const handlers: Record<string, (params: any) => Promise<unknown> | unknown> = {
  list_tabs: async (_params: ListTabsParams): Promise<ListTabsResult> => {
    const tabs = await chrome.tabs.query({});
    const resultTabs: TabInfo[] = [];

    for (const t of tabs) {
      if (t.id !== undefined && t.url && (t.url.startsWith('http://') || t.url.startsWith('https://'))) {
        resultTabs.push({
          id: t.id,
          url: t.url,
          title: t.title ?? '',
          active: !!t.active,
          windowId: t.windowId,
        });
      }
    }

    return { tabs: resultTabs };
  },

  inspect_page: async (params: InspectPageParams): Promise<InspectPageResult> => {
    const { tabId, tab } = await resolveHttpTab(params.tabId);
    await ensureContentScript(tabId);

    const inspectMsg: InspectMessage = {
      type: 'DIORAMA_INSPECT',
      limit: params.limit ?? 60,
    };
    const partial = await sendToTab<Omit<InspectPageResult, 'tabId' | 'screenshotPng'>>(tabId, inspectMsg);

    let screenshotPng: string | undefined;
    if (params.screenshot !== false) {
      if (!tab.active) {
        await chrome.tabs.update(tabId, { active: true });
        await new Promise((r) => setTimeout(r, 150));
      }
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      screenshotPng = dataUrl.replace(/^data:image\/png;base64,/, '');
    }

    let userSelection: InspectPageResult['userSelection'];
    try {
      const pickerMsg: PickerStateMessage = { type: 'DIORAMA_PICKER_STATE' };
      const picker = await sendToTab<PickerStateResponse>(tabId, pickerMsg);
      if (picker && picker.open) {
        userSelection = {
          selectors: picker.selectors,
          brief: picker.brief,
          frameFormat: picker.frameFormat,
        };
      }
    } catch {
      // ignore
    }

    return {
      tabId,
      url: partial.url,
      title: partial.title,
      viewport: partial.viewport,
      document: partial.document,
      screenshotPng,
      candidates: partial.candidates,
      userSelection,
    };
  },

  capture: async (params: CaptureParams): Promise<CaptureResult> => {
    const { tabId } = await resolveHttpTab(params.tabId);
    await ensureContentScript(tabId);

    // Launch waitForNextBundle before triggering capture
    const bundlePromise = waitForNextBundle(180000);

    const captureMsg: AgentCaptureMessage = {
      type: 'DIORAMA_AGENT_CAPTURE',
      selectors: params.selectors || [],
      intent: {
        brief: params.brief,
        frameFormat: params.frameFormat,
      },
      expandClusters: !!params.expandClusters,
    };

    const response = await sendToTab<{ ok: boolean; error?: string }>(tabId, captureMsg);
    if (!response || !response.ok) {
      throw new Error(response?.error || 'Échec de la capture agent');
    }

    const bundle = await bundlePromise;
    const raster = bundle.raster;
    const rasterError = raster?.error;
    const rasterComplete = !!(raster?.backgroundPng && raster.layers && raster.layers.every((l) => !!l.png));

    return {
      bundle: summarize(bundle),
      raster: rasterError ? 'error' : (rasterComplete ? 'native' : 'fallback'),
      rasterError,
    };
  },

  wait_for_capture: async (params: WaitForCaptureParams): Promise<WaitForCaptureResult> => {
    const timeoutMs = params.timeoutMs ?? 120000;
    const bundle = await waitForNextBundle(timeoutMs);
    return {
      bundle: summarize(bundle),
    };
  },

  open_studio: async (_params: OpenStudioParams): Promise<OpenStudioResult> => {
    const tabId = await openOrFocusStudio();
    return { tabId };
  },
};

export function ensureAgentClient(): AgentClient {
  if (!clientInstance) {
    clientInstance = new AgentClient({
      role: 'background',
      handlers,
    });
    clientInstance.start();
  }
  return clientInstance;
}
