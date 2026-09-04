import { AGENT_INJECTION_KEY, PENDING_SELECTION_KEY } from '../shared/types';
import type { CaptureIntent, DioramaMessage } from '../shared/types';
import { clusterSiblings, resolveTarget, staggerOrder } from './cluster';
import { inspectPage } from './inspect';
import { mountOverlay, pickerState, showError, showToast } from './overlay';
import { cleanupLiveElements, serializeCapture, tagLiveElements } from './serialize';

let isCapturing = false;

function resolveSelectors(selectors: string[]): Element[] {
  if (selectors.length === 0) return [];
  tagLiveElements();
  const out: Element[] = [];
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && !out.includes(el)) out.push(el);
  }
  return out;
}

function selectorsOf(elements: Element[]): string[] {
  const out: string[] = [];
  for (const el of elements) {
    const dioId = el.getAttribute('data-dio-id');
    if (dioId) out.push(`[data-dio-id="${dioId}"]`);
  }
  return out;
}

async function captureElements(members: Element[], score: number, intent?: CaptureIntent) {
  const toast = showToast('Capture de la page et ouverture du Studio 3D…');
  try {
    const bundle = await serializeCapture({
      zapped: members,
      clusterScore: score,
    });
    bundle.selection = { selectors: selectorsOf(members) };
    if (intent) {
      bundle.intent = intent;
    }

    await chrome.runtime.sendMessage({
      type: 'DIORAMA_BUNDLE',
      bundle,
    });
  } finally {
    toast.remove();
    cleanupLiveElements();
  }
}

async function startDiorama(initialSelectors: string[] = []) {
  if (isCapturing) return;

  const existingOverlay = document.querySelector('[data-diorama-overlay]');
  if (existingOverlay) {
    existingOverlay.remove();
    return;
  }

  isCapturing = true;
  try {
    const initial = resolveSelectors(initialSelectors);
    const result = await mountOverlay(initial);
    if (!result) {
      cleanupLiveElements();
      return; // User cancelled with Escape
    }

    await captureElements(result.members, result.score, result.intent);
  } catch (err) {
    cleanupLiveElements();
    showError(`Diorama : échec de la capture — ${String(err)}`);
  } finally {
    isCapturing = false;
  }
}

// Listen for messages from background script
try {
  chrome.runtime.onMessage.addListener((message: DioramaMessage, _sender, sendResponse) => {
    if (message?.type === 'DIORAMA_TOGGLE' || message?.type === 'DIORAMA_START') {
      const selectors =
        message.type === 'DIORAMA_START' && Array.isArray(message.selectors)
          ? message.selectors
          : [];
      void startDiorama(selectors);
      sendResponse({ ok: true });
      return true;
    }

    if (message?.type === 'DIORAMA_INSPECT') {
      try {
        const res = inspectPage(message.limit);
        sendResponse(res);
      } catch (err) {
        console.error('[diorama] inspectPage failed:', err);
        sendResponse({ ok: false, error: String(err) });
      }
      return true;
    }

    if (message?.type === 'DIORAMA_PICKER_STATE') {
      sendResponse(pickerState());
      return true;
    }

    if (message?.type === 'DIORAMA_AGENT_CAPTURE') {
      (async () => {
        try {
          tagLiveElements();
          const missingSelectors: string[] = [];
          const matchedElements: Element[] = [];

          for (const selector of message.selectors) {
            const el = document.querySelector(selector);
            if (!el) {
              missingSelectors.push(selector);
            } else if (!matchedElements.includes(el)) {
              matchedElements.push(el);
            }
          }

          if (missingSelectors.length > 0) {
            sendResponse({
              ok: false,
              error: `Selectors not found: ${missingSelectors.join(', ')}`,
            });
            return;
          }

          let finalElements: Element[] = [];
          if (message.expandClusters) {
            const expandedSet = new Set<Element>();
            for (const el of matchedElements) {
              const target = resolveTarget(el);
              const cluster = clusterSiblings(target);
              for (const member of cluster.members) {
                expandedSet.add(member);
              }
            }
            finalElements = Array.from(expandedSet);
          } else {
            finalElements = matchedElements;
          }

          finalElements = staggerOrder(finalElements);

          // Close overlay if open
          const existingOverlay = document.querySelector('[data-diorama-overlay]');
          if (existingOverlay) {
            existingOverlay.remove();
          }

          await captureElements(finalElements, 1, message.intent);
          sendResponse({ ok: true });
        } catch (err) {
          cleanupLiveElements();
          sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      })();
      return true;
    }

    return false;
  });
} catch {
  // Ignored if not in extension context
}

/** Consumes the one-shot selection parked by the background before injection. */
async function takePendingSelection(): Promise<string[]> {
  try {
    const stored = await chrome.storage.local.get(PENDING_SELECTION_KEY);
    const pending = stored[PENDING_SELECTION_KEY] as
      | { url: string; selectors: string[] }
      | undefined;
    if (!pending) return [];
    await chrome.storage.local.remove(PENDING_SELECTION_KEY);
    return pending.url === location.href ? pending.selectors : [];
  } catch {
    return [];
  }
}

async function initContent() {
  try {
    const agentStored = await chrome.storage.local.get(AGENT_INJECTION_KEY);
    if (agentStored[AGENT_INJECTION_KEY]) {
      await chrome.storage.local.remove(AGENT_INJECTION_KEY);
      return;
    }
  } catch {
    // ignore
  }

  const selectors = await takePendingSelection();
  void startDiorama(selectors);
}

void initContent();
