import { useEffect } from 'react';
import { useStudio } from './store';
import { BUNDLE_STORAGE_KEY } from '../shared/types';
import type { CaptureBundle } from '../shared/types';
import { Topbar } from './components/Topbar';
import { Viewport } from './components/Viewport';
import { Inspector } from './components/Inspector';
import { Timeline } from './components/timeline/Timeline';
import { hasCompleteNativeRaster, isHtmlInCanvasSupported } from './engine/sceneBuilder';

import { startStudioAgent } from './agent/api';

function isTextTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function App() {
  const setBundle = useStudio((s) => s.setBundle);
  const mergeBundle = useStudio((s) => s.mergeBundle);
  const setError = useStudio((s) => s.setError);
  const setPlaying = useStudio((s) => s.setPlaying);
  const error = useStudio((s) => s.error);
  const bundle = useStudio((s) => s.bundle);

  useEffect(() => {
    (async () => {
      try {
        const stored = await chrome.storage.local.get(BUNDLE_STORAGE_KEY);
        const storedBundle = stored[BUNDLE_STORAGE_KEY] as CaptureBundle | undefined;
        if (!storedBundle) {
          setError("Aucun bundle capturé. Cliquez sur l'icône Diorama sur une page.");
          return;
        }
        if (!hasCompleteNativeRaster(storedBundle) && !isHtmlInCanvasSupported()) {
          setError(
            "Le raster natif est incomplet et l'API de fallback HTML-in-Canvas est absente. " +
              'Relancez la capture ou activez --enable-blink-features=HTMLInCanvas.',
          );
          return;
        }
        setBundle(storedBundle);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
  }, [setBundle, setError]);

  // A re-selection rewrites the stored bundle: adopt it without losing the edit state.
  useEffect(() => {
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      const change = changes[BUNDLE_STORAGE_KEY];
      if (!change?.newValue) return;
      const next = change.newValue as CaptureBundle;
      if (useStudio.getState().bundle) mergeBundle(next);
      else setBundle(next);
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, [mergeBundle, setBundle]);

  // Agent API client
  useEffect(() => {
    const stop = startStudioAgent();
    return () => stop();
  }, []);

  // Global hotkeys: Space toggles playback, J/K jump keyframes. Viewport-specific keys live in Viewport.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (isTextTarget(ev.target)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ev.code === 'Space') {
        ev.preventDefault();
        setPlaying(!useStudio.getState().playing);
      } else if (ev.key === 'j' || ev.key === 'J') {
        ev.preventDefault();
        useStudio.getState().jumpToPrevKeyframe();
      } else if (ev.key === 'k' || ev.key === 'K') {
        ev.preventDefault();
        useStudio.getState().jumpToNextKeyframe();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setPlaying]);

  return (
    <div className="app">
      <Topbar />
      <div className="app-main">
        <Viewport />
        <Inspector />
      </div>
      <Timeline />
      {error && !bundle && (
        <div className="app-error" role="alert">
          <strong>Diorama</strong>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
