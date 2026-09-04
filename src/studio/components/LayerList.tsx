import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import { Crosshair, Eye, EyeOff, Lock, LockOpen } from 'lucide-react';
import { orderedLayers, useStudio } from '../store';
import type { CaptureLayer } from '../../shared/types';
import { viewportHandle } from './Viewport';
import '../styles/shell.css';

export function LayerList() {
  const bundle = useStudio((s) => s.bundle);
  const layers = useMemo(() => orderedLayers(bundle), [bundle]);
  const zaps = layers.filter((l) => l.role === 'zap');
  const background = layers.find((l) => l.role === 'background') ?? null;

  return (
    <aside className="layerlist" aria-label="Couches">
      <div className="panel-head">
        <span className="panel-title">Couches</span>
        <span className="panel-count">{zaps.length}</span>
      </div>
      <div className="layerlist-scroll">
        {zaps.length === 0 ? (
          <div className="layerlist-empty">Aucun élément détaché. Modifiez la sélection sur la page source.</div>
        ) : (
          zaps.map((layer) => <LayerRow key={layer.id} layer={layer} />)
        )}
      </div>
      {background && (
        <div className="layerlist-bg">
          <LayerRow layer={background} />
        </div>
      )}
    </aside>
  );
}

function LayerRow({ layer }: { layer: CaptureLayer }) {
  const id = layer.id;
  const state = useStudio((s) => s.layers[id]);
  const selected = useStudio((s) => s.selection.includes(id));
  const hovered = useStudio((s) => s.hoveredLayerId === id);
  const thumb = useStudio(
    (s) => s.bundle?.raster?.layers?.find((l) => l.layerId === id)?.png ?? null,
  );
  const select = useStudio((s) => s.select);
  const setHovered = useStudio((s) => s.setHovered);
  const setLayerFlags = useStudio((s) => s.setLayerFlags);
  const setCameraValues = useStudio((s) => s.setCameraValues);

  const visible = state?.visible ?? true;
  const locked = state?.locked ?? false;
  const isBackground = layer.role === 'background';

  const onClick = (e: MouseEvent) => {
    if (e.shiftKey) select([id], 'toggle');
    else if (e.metaKey || e.ctrlKey) select([id], 'add');
    else select([id], 'replace');
  };

  const fit = () => {
    const renderer = viewportHandle.renderer;
    const bundle = useStudio.getState().bundle;
    if (!renderer || !bundle) return;
    const fitted = renderer.fitLayer(bundle, id, renderer.camera.fov);
    if (fitted) setCameraValues(fitted);
  };

  const classes = ['layer-row'];
  if (selected) classes.push('selected');
  if (hovered) classes.push('hovered');
  if (!visible) classes.push('hidden');

  return (
    <div
      className={classes.join(' ')}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select([id], e.shiftKey ? 'toggle' : 'replace');
        }
      }}
      onMouseEnter={() => setHovered(id)}
      onMouseLeave={() => setHovered(null)}
      title={layer.label}
    >
      {thumb ? (
        <span className="layer-thumb">
          <img src={thumb} alt="" draggable={false} />
        </span>
      ) : (
        <span
          className="layer-thumb plate"
          style={isBackground && state?.backgroundColor ? { background: state.backgroundColor } : undefined}
        />
      )}
      <span className="layer-label">{isBackground ? 'Fond' : layer.label}</span>
      <span className="layer-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="icon-btn"
          title="Cadrer la couche"
          aria-label="Cadrer la couche"
          onClick={fit}
        >
          <Crosshair size={13} />
        </button>
        <button
          type="button"
          className={visible ? 'icon-btn' : 'icon-btn on'}
          title={visible ? 'Masquer' : 'Afficher'}
          aria-label={visible ? 'Masquer' : 'Afficher'}
          aria-pressed={!visible}
          onClick={() => setLayerFlags(id, { visible: !visible })}
        >
          {visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button
          type="button"
          className={locked ? 'icon-btn on' : 'icon-btn'}
          title={locked ? 'Déverrouiller' : 'Verrouiller'}
          aria-label={locked ? 'Déverrouiller' : 'Verrouiller'}
          aria-pressed={locked}
          onClick={() => setLayerFlags(id, { locked: !locked })}
        >
          {locked ? <Lock size={13} /> : <LockOpen size={13} />}
        </button>
      </span>
    </div>
  );
}
