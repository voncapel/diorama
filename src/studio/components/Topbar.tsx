import { Box, Download, ExternalLink, Focus, Maximize2, MousePointer2, MousePointerClick, Orbit, RectangleHorizontal } from 'lucide-react';
import { useStudio } from '../store';
import type { Tool } from '../store';
import { viewportHandle } from './Viewport';
import { Segmented } from './ui/Segmented';
import type { SegmentedOption } from './ui/Segmented';
import '../styles/shell.css';

const TOOL_OPTIONS: readonly SegmentedOption<Tool>[] = [
  { value: 'select', label: 'Sélection', icon: <MousePointer2 size={13} />, title: 'Sélection (V)' },
  { value: 'orbit', label: 'Orbite', icon: <Orbit size={13} />, title: 'Orbite (O)' },
  { value: 'focus', label: 'Mise au point', icon: <Focus size={13} />, title: 'Mise au point (F)' },
];

/** Default angled view; the fit keeps distance and target, only the orbit changes. */
const PERSPECTIVE = { orbitX: 16, orbitY: -22 } as const;

export function Topbar() {
  const bundle = useStudio((s) => s.bundle);
  const tool = useStudio((s) => s.tool);
  const setTool = useStudio((s) => s.setTool);
  const setCameraValues = useStudio((s) => s.setCameraValues);
  const setInspector = useStudio((s) => s.setInspector);
  const setError = useStudio((s) => s.setError);
  const exporting = useStudio((s) => s.exporting);
  const agentConnected = useStudio((s) => s.agentConnected);

  const flatView = () => {
    const renderer = viewportHandle.renderer;
    if (!renderer || !bundle) return;
    setCameraValues({ ...renderer.fitCamera(bundle, useStudio.getState().camera.fov), orbitX: 0, orbitY: 0, roll: 0 });
  };

  const perspectiveView = () => {
    setCameraValues({ ...PERSPECTIVE });
  };

  const refit = () => {
    const renderer = viewportHandle.renderer;
    if (!renderer || !bundle) return;
    setCameraValues(renderer.fitAll(bundle, useStudio.getState().camera.fov));
  };

  const handleReselect = async () => {
    if (!bundle) return;
    // The content script resolves `[data-dio-id="N"]`, so the fallback rebuilds
    // that form from `stableId`: `layer.selector` is the positional
    // `[data-diorama-layer="L1"]` marker, which only exists inside the clone.
    const selectors =
      bundle.selection?.selectors ??
      bundle.layers
        .filter((l) => l.role === 'zap' && l.stableId)
        .map((l) => `[data-dio-id="${l.stableId}"]`);
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'DIORAMA_RESELECT',
        url: bundle.source.url,
        selectors,
      })) as { ok: boolean; error?: string } | undefined;
      if (res && !res.ok) {
        setError(`Retour en sélection impossible : ${res.error ?? 'onglet source introuvable'}`);
      }
    } catch (err) {
      setError(`Retour en sélection impossible : ${String(err)}`);
    }
  };

  let hostname = '';
  if (bundle?.source.url) {
    try {
      hostname = new URL(bundle.source.url).hostname;
    } catch {
      hostname = bundle.source.url;
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="topbar-logo" aria-hidden="true">
          <Box size={14} />
        </span>
        <span className="topbar-name">Diorama</span>
        {bundle && (
          <span className="topbar-source" title={`${bundle.source.title} (${bundle.source.url})`}>
            {bundle.source.title || hostname}
          </span>
        )}
      </div>

      <div className="topbar-center">
        <Segmented value={tool} options={TOOL_OPTIONS} onChange={setTool} ariaLabel="Outil" />

        <div className="segmented" role="group" aria-label="Vues">
          <button type="button" className="segmented-item" onClick={flatView} disabled={!bundle} title="Caméra face à la page">
            <RectangleHorizontal size={13} />
            <span>Vue à plat</span>
          </button>
          <button type="button" className="segmented-item" onClick={perspectiveView} disabled={!bundle} title="Vue angulée par défaut">
            <Box size={13} />
            <span>Perspective</span>
          </button>
          <button type="button" className="segmented-item" onClick={refit} disabled={!bundle} title="Cadrer toutes les couches">
            <Maximize2 size={13} />
            <span>Recadrer</span>
          </button>
        </div>

        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void handleReselect()}
          disabled={!bundle}
          title="Revenir sur la page d'origine pour ajouter ou retirer des éléments"
        >
          <MousePointerClick size={13} />
          Modifier la sélection
        </button>
      </div>

      <div className="topbar-right">
        <div
          className="agent-dot-container"
          title={agentConnected ? 'Agent connecté' : 'Bridge agent absent'}
        >
          <span className={`agent-dot${agentConnected ? ' connected' : ''}`} />
          <span>Agent</span>
        </div>
        {bundle?.source.url && (
          <a
            href={bundle.source.url}
            target="_blank"
            rel="noreferrer"
            className="btn btn-ghost"
            style={{ textDecoration: 'none' }}
            title="Ouvrir la page d'origine dans un nouvel onglet"
          >
            <ExternalLink size={13} />
            Page source
          </a>
        )}
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => setInspector('export')}
          disabled={!bundle}
          title="Ouvrir le panneau d'export"
        >
          <Download size={13} />
          {exporting ? 'Export en cours' : 'Export'}
        </button>
      </div>
    </header>
  );
}
