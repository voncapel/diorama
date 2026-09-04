import { BUNDLE_STORAGE_KEY, PENDING_SELECTION_KEY } from '../shared/types';
import type { DioramaMessage, FetchAssetResponse } from '../shared/types';
import { captureNativeRaster } from './cdpRaster';
import { ensureAgentClient, notifyBundle } from './agent';
import { findStudioTab } from './studioTab';

// Initialize agent WebSocket client
ensureAgentClient();

chrome.runtime.onStartup.addListener(() => {
  ensureAgentClient();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureAgentClient();
  chrome.alarms.create('diorama-agent', { periodInMinutes: 1 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'diorama-agent') {
    ensureAgentClient();
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'DIORAMA_TOGGLE' });
  } catch {
    chrome.scripting
      .executeScript({ target: { tabId: tab.id }, files: ['content.js'] })
      .catch((err) => console.error('[diorama] injection failed', err));
  }
});

async function blobToDataUri(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  const mime = blob.type || 'application/octet-stream';
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * Moves the visible browser away from the source before CDP starts mutating it.
 * An in-page cover would enter the compositor screenshots (or flash whenever hidden),
 * so the cover deliberately lives in a temporary extension tab instead.
 */
async function openCaptureCover(sourceTabId: number): Promise<number | undefined> {
  try {
    const source = await chrome.tabs.get(sourceTabId);
    const loading = await chrome.tabs.create({
      url: chrome.runtime.getURL('loading.html'),
      active: true,
      windowId: source.windowId,
      index: source.index + 1,
    });
    if (source.windowId !== undefined) {
      await chrome.windows.update(source.windowId, { focused: true }).catch(() => undefined);
    }
    return loading.id;
  } catch (error) {
    console.warn('[diorama] could not open the capture cover:', error);
    return undefined;
  }
}

async function closeCaptureCover(tabId: number | undefined): Promise<void> {
  if (tabId === undefined) return;
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

/**
 * Reuses the existing Studio tab when there is one: re-opening a fresh tab would
 * drop every edit made so far (camera, keyframes, layer settings).
 */
async function openStudioWithBundle(
  message: Extract<DioramaMessage, { type: 'DIORAMA_BUNDLE' }>,
  sourceTabId?: number,
) {
  const coverTabId = sourceTabId === undefined ? undefined : await openCaptureCover(sourceTabId);
  try {
    if (sourceTabId !== undefined) {
      message.bundle.raster = await captureNativeRaster(sourceTabId, message.bundle);
      if (message.bundle.raster.error) {
        console.warn('[diorama] native raster unavailable; keeping clone fallback:', message.bundle.raster.error);
      }
    }
    await chrome.storage.local.set({ [BUNDLE_STORAGE_KEY]: message.bundle });
    notifyBundle(message.bundle);

    const studio = await findStudioTab();
    if (studio?.id) {
      await chrome.tabs.update(studio.id, { active: true });
      if (studio.windowId !== undefined) {
        await chrome.windows.update(studio.windowId, { focused: true }).catch(() => undefined);
      }
      // The storage listener already reloads it; this is only a nudge for older tabs.
      chrome.tabs.sendMessage(studio.id, { type: 'DIORAMA_BUNDLE_UPDATED' }).catch(() => undefined);
      return;
    }
    await chrome.tabs.create({ url: chrome.runtime.getURL('studio.html') });
  } finally {
    await closeCaptureCover(coverTabId);
  }
}

/** Re-activates the captured page and restarts the picker with the current selection. */
async function reselect(message: Extract<DioramaMessage, { type: 'DIORAMA_RESELECT' }>) {
  const tabs = await chrome.tabs.query({});
  const target =
    tabs.find((tab) => tab.url === message.url) ??
    tabs.find((tab) => tab.url && tab.url.split('#')[0] === message.url.split('#')[0]);
  if (!target?.id) throw new Error('onglet source introuvable');

  await chrome.tabs.update(target.id, { active: true });
  if (target.windowId !== undefined) {
    await chrome.windows.update(target.windowId, { focused: true }).catch(() => undefined);
  }

  await chrome.storage.local.set({
    [PENDING_SELECTION_KEY]: { url: message.url, selectors: message.selectors },
  });

  try {
    await chrome.tabs.sendMessage(target.id, {
      type: 'DIORAMA_START',
      selectors: message.selectors,
    });
    await chrome.storage.local.remove(PENDING_SELECTION_KEY);
  } catch {
    // No content script yet: inject it, it will consume the parked selection.
    await chrome.scripting.executeScript({ target: { tabId: target.id }, files: ['content.js'] });
  }
}

chrome.runtime.onMessage.addListener((message: DioramaMessage, sender, sendResponse) => {
  if (message?.type === 'DIORAMA_BUNDLE') {
    openStudioWithBundle(message, sender.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message?.type === 'DIORAMA_RESELECT') {
    reselect(message)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }

  if (message?.type === 'DIORAMA_FETCH_ASSET') {
    (async (): Promise<FetchAssetResponse> => {
      try {
        const res = await fetch(message.url, { credentials: 'omit' });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        const blob = await res.blob();
        // Guard against absurd payloads eating the message channel.
        if (blob.size > 8 * 1024 * 1024) return { ok: false, error: 'asset too large' };
        return { ok: true, dataUri: await blobToDataUri(blob) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    })().then(sendResponse);
    return true;
  }

  return false;
});
