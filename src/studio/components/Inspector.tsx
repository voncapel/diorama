import { useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Box,
  Camera,
  Crosshair,
  Download,
  Focus,
  Frame,
  Layers,
  RectangleHorizontal,
  RotateCw,
  Sun,
  Undo2,
  X,
  Folder,
  Sparkles,
  Ungroup,
} from 'lucide-react';
import { useStudio } from '../store';
import { childrenOfLayer, parentOfLayer } from '../../shared/groups';
import type { InspectorTarget } from '../store';
import {
  CHANNEL_GROUP_LABELS,
  channelsForTarget,
  groupsForTarget,
} from '../model/channels';
import type {
  CameraChannelId,
  CameraValues,
  ChannelDef,
  ChannelGroup,
  ChannelId,
  LayerChannelId,
  SceneChannelId,
} from '../model/channels';
import type { DioramaRenderer } from '../engine/renderer';
import type { FrameFormatName, FrameState } from '../engine/frame';
import { FRAME_FORMATS } from '../engine/frame';
import type { ExportQualityName } from '../export';
import { EXPORT_QUALITIES, downloadBlob, resolveExportSize } from '../export';
import { restoreLiveElement } from '../../content/serialize';
import { viewportHandle } from './Viewport';
import { ColorField } from './ColorField';
import { KeyDot } from './ui/KeyDot';
import { KeyJumpButtons } from './ui/KeyJumpButtons';
import { NumberField } from './ui/NumberField';
import { Section } from './ui/Section';
import { Segmented } from './ui/Segmented';
import type { SegmentedOption } from './ui/Segmented';
import { Toggle } from './ui/Toggle';
import { useEvaluatedValues } from './useEvaluated';
import '../styles/inspector.css';

const TABS: { id: InspectorTarget; label: string; icon: ReactNode }[] = [
  { id: 'layer', label: 'Couche', icon: <Layers size={14} /> },
  { id: 'camera', label: 'Caméra', icon: <Camera size={14} /> },
  { id: 'scene', label: 'Scène', icon: <Sun size={14} /> },
  { id: 'frame', label: 'Cadre', icon: <Frame size={14} /> },
  { id: 'export', label: 'Export', icon: <Download size={14} /> },
];

import { runExport } from '../agent/exportRun';

export function Inspector() {
  const inspector = useStudio((s) => s.inspector);
  const setInspector = useStudio((s) => s.setInspector);

  return (
    <aside className="inspector" aria-label="Inspecteur">
      <div className="inspector-tabs" role="tablist">
        {TABS.map((tab) => {
          const active = inspector === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={tab.label}
              title={tab.label}
              className={`inspector-tab${active ? ' active' : ''}${tab.id === 'export' ? ' export' : ''}`}
              onClick={() => setInspector(tab.id)}
            >
              {tab.icon}
            </button>
          );
        })}
      </div>
      {inspector === 'layer' && <LayerView />}
      {inspector === 'camera' && <CameraView />}
      {inspector === 'scene' && <SceneView />}
      {inspector === 'frame' && <FrameView />}
      {inspector === 'export' && <ExportView />}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Shared channel row                                                  */
/* ------------------------------------------------------------------ */

interface ChannelRowProps {
  def: ChannelDef;
  /** null = mixed values across the selection. */
  value: number | null;
  onChange: (value: number) => void;
  keyTarget: string | null | readonly string[];
  disabled?: boolean;
  titleOverride?: string;
}

function ChannelRow({ def, value, onChange, keyTarget, disabled = false, titleOverride }: ChannelRowProps) {
  const unit = def.unit ?? '';
  const title = titleOverride ?? def.label;
  const numberField = (
    <NumberField
      value={value}
      onChange={onChange}
      step={def.step}
      precision={def.precision}
      min={def.min}
      max={def.max}
      unit={unit}
      disabled={disabled}
      title={title}
    />
  );

  if (def.soft) {
    const [lo, hi] = def.soft;
    const sliderStep = def.precision > 0 ? 10 ** -def.precision : 1;
    return (
      <div className="prop-row">
        <KeyDot layerId={keyTarget} channel={def.id as ChannelId} />
        <span className="prop-label static">{def.label}</span>
        <div className="slider-row">
          <input
            type="range"
            min={lo}
            max={hi}
            step={sliderStep}
            value={value ?? (lo + hi) / 2}
            disabled={disabled}
            title={title}
            aria-label={def.label}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          {numberField}
        </div>
      </div>
    );
  }

  return (
    <div className="prop-row">
      <KeyDot layerId={keyTarget} channel={def.id as ChannelId} />
      <NumberField
        label={def.label}
        value={value}
        onChange={onChange}
        step={def.step}
        precision={def.precision}
        min={def.min}
        max={def.max}
        unit={unit}
        disabled={disabled}
        title={title}
      />
    </div>
  );
}

/** Shared camera fit path: the renderer computes, the store owns the result. */
function applyFit(compute: (renderer: DioramaRenderer, fov: number) => Partial<CameraValues> | null) {
  const renderer = viewportHandle.renderer;
  if (!renderer) return;
  const fitted = compute(renderer, useStudio.getState().camera.fov);
  if (fitted) useStudio.getState().setCameraValues(fitted);
}

/* ------------------------------------------------------------------ */
/* Layer view                                                          */
/* ------------------------------------------------------------------ */

function LayerView() {
  const selection = useStudio((s) => s.selection);
  const bundle = useStudio((s) => s.bundle);
  const layers = useStudio((s) => s.layers);
  const setLayerValue = useStudio((s) => s.setLayerValue);
  const setLayerFlags = useStudio((s) => s.setLayerFlags);
  const removeLayer = useStudio((s) => s.removeLayer);
  const applyGroupOpening = useStudio((s) => s.applyGroupOpening);
  const ungroup = useStudio((s) => s.ungroup);
  const setLayerParent = useStudio((s) => s.setLayerParent);
  const playhead = useStudio((s) => s.playhead);
  const { layers: resolvedLayers } = useEvaluatedValues();

  const ids = useMemo(() => selection.filter((id) => layers[id] !== undefined), [selection, layers]);
  const states = ids.map((id) => layers[id]).filter((l): l is NonNullable<typeof l> => l !== undefined);
  const groups = groupsForTarget('layer');
  const defs = channelsForTarget('layer');

  if (ids.length === 0 || states.length === 0) {
    return (
      <div className="inspector-body">
        <div className="inspector-empty">
          <Layers size={22} />
          <span>Sélectionnez une couche dans le viewport ou la liste</span>
        </div>
      </div>
    );
  }

  const first = states[0]!;
  const captureLayers = ids.map((id) => bundle?.layers.find((l) => l.id === id) ?? null);
  const single = ids.length === 1 ? captureLayers[0] ?? null : null;
  const anyBackground = captureLayers.some((l) => l?.role === 'background');

  const valueOf = (channel: LayerChannelId): number | null => {
    const firstId = ids[0];
    if (!firstId) return null;
    const firstResolved = resolvedLayers[firstId];
    if (!firstResolved) return null;
    const v = firstResolved[channel];
    for (let i = 1; i < ids.length; i++) {
      const id = ids[i];
      if (!id) continue;
      const res = resolvedLayers[id];
      if (!res || res[channel] !== v) return null;
    }
    return v;
  };
  const flagOf = (flag: 'visible' | 'castShadow' | 'locked'): boolean => states.every((st) => st[flag]);

  const setAll = (channel: LayerChannelId, v: number) => {
    for (const id of ids) setLayerValue(id, channel, v);
  };

  const fit = () => {
    const b = useStudio.getState().bundle;
    const target = ids[0];
    if (!b || !target) return;
    applyFit((r, fov) => (ids.length === 1 ? r.fitLayer(b, target, fov) : r.fitAll(b, fov)));
  };

  const reintegrate = () => {
    for (const layer of captureLayers) {
      if (!layer || layer.role !== 'zap') continue;
      restoreLiveElement(layer.selector);
      removeLayer(layer.id);
    }
  };

  const bgColor = single?.role === 'background' ? first.backgroundColor ?? single.backgroundColor ?? '#ffffff' : null;

  const parentId = single ? parentOfLayer(bundle?.groups, single.id) : null;
  const parentLayer = parentId ? bundle?.layers.find((l) => l.id === parentId) : null;
  const childIds = single ? childrenOfLayer(bundle?.groups, single.id) : [];

  return (
    <div className="inspector-body">
      <div className="inspector-heading">
        <div className="inspector-title-row">
          <span className="name" title={single?.label}>
            {single ? (single.role === 'background' ? 'Fond' : single.label) : `${ids.length} couches`}
          </span>
          <KeyJumpButtons compact />
        </div>
        <span className="meta">{single ? (single.role === 'background' ? 'arrière-plan' : 'élément') : 'sélection multiple'}</span>
      </div>

      {parentId && single && (
        <div className="group-section" aria-label="Groupe">
          <div className="group-section-header">
            <Folder size={13} />
            <span>Membre de groupe</span>
          </div>
          <div className="group-section-body">
            Parent : <strong>{parentLayer ? parentLayer.label : parentId}</strong>
          </div>
          <div className="group-section-actions">
            <button
              type="button"
              className="btn"
              title="Détacher du parent"
              aria-label="Détacher du parent"
              onClick={() => setLayerParent(single.id, null)}
            >
              <Ungroup size={13} />
              Détacher
            </button>
          </div>
        </div>
      )}

      {childIds.length > 0 && single && (
        <div className="group-section" aria-label="Groupe conteneur">
          <div className="group-section-header">
            <Folder size={13} />
            <span>Groupe conteneur</span>
          </div>
          <div className="group-section-body">
            Contient <span className="group-section-count">{childIds.length}</span> élément{childIds.length > 1 ? 's' : ''} interne{childIds.length > 1 ? 's' : ''}.
          </div>
          <div className="group-section-actions">
            <button
              type="button"
              className="btn btn-accent"
              title="Animer l’ouverture du groupe"
              aria-label="Animer l’ouverture du groupe"
              onClick={() => applyGroupOpening(single.id, playhead)}
            >
              <Sparkles size={13} />
              Animer l’ouverture
            </button>
            <button
              type="button"
              className="btn"
              title="Dégrouper les éléments"
              aria-label="Dégrouper les éléments"
              onClick={() => ungroup(single.id)}
            >
              <Ungroup size={13} />
              Dégrouper
            </button>
          </div>
        </div>
      )}

      {bgColor !== null && single && (
        <ColorField
          label="Couleur"
          value={bgColor}
          onChange={(color) => setLayerFlags(single.id, { backgroundColor: color })}
        />
      )}

      {groups.map((group) => (
        <ChannelGroupSection
          key={group}
          group={group}
          defs={defs.filter((d) => d.group === group)}
          defaultOpen={group === 'position' || group === 'rotation' || group === 'scale' || group === 'appearance'}
          valueOf={(def) => valueOf(def.id as LayerChannelId)}
          onChange={(def, v) => setAll(def.id as LayerChannelId, v)}
          keyTarget={ids}
        />
      ))}

      <div className="stack">
        <Toggle
          label="Visible"
          checked={flagOf('visible')}
          onChange={(v) => ids.forEach((id) => setLayerFlags(id, { visible: v }))}
        />
        <Toggle
          label="Verrouillée"
          checked={flagOf('locked')}
          onChange={(v) => ids.forEach((id) => setLayerFlags(id, { locked: v }))}
        />
        <Toggle
          label="Projette une ombre"
          checked={flagOf('castShadow')}
          disabled={anyBackground}
          title={anyBackground ? 'Le fond ne projette jamais d’ombre' : 'Nécessite la lumière de scène'}
          onChange={(v) => ids.forEach((id) => setLayerFlags(id, { castShadow: v }))}
        />
      </div>

      <div className="row-actions">
        <button type="button" className="btn" onClick={fit} disabled={!bundle} title="Cadrer la sélection dans la caméra">
          <Crosshair size={13} />
          Cadrer
        </button>
        {!anyBackground && (
          <button
            type="button"
            className="btn btn-danger"
            onClick={reintegrate}
            title="Réintégrer la couche dans la page et la retirer de la scène (Suppr)"
          >
            <Undo2 size={13} />
            Réintégrer
          </button>
        )}
      </div>
    </div>
  );
}

interface ChannelGroupSectionProps {
  group: ChannelGroup;
  defs: readonly ChannelDef[];
  defaultOpen?: boolean;
  valueOf: (def: ChannelDef) => number | null;
  onChange: (def: ChannelDef, value: number) => void;
  keyTarget: string | null | readonly string[];
  disabled?: boolean | ((def: ChannelDef) => boolean);
  titleOverride?: (def: ChannelDef) => string | undefined;
  extra?: ReactNode;
  footer?: ReactNode;
}

function ChannelGroupSection({
  group,
  defs,
  defaultOpen = true,
  valueOf,
  onChange,
  keyTarget,
  disabled = false,
  titleOverride,
  extra,
  footer,
}: ChannelGroupSectionProps) {
  return (
    <Section title={CHANNEL_GROUP_LABELS[group]} defaultOpen={defaultOpen} extra={extra} footer={footer}>
      {defs.map((def) => {
        const isDisabled = typeof disabled === 'function' ? disabled(def) : disabled;
        const customTitle = titleOverride ? titleOverride(def) : undefined;
        return (
          <ChannelRow
            key={def.id}
            def={def}
            value={valueOf(def)}
            onChange={(v) => onChange(def, v)}
            keyTarget={keyTarget}
            disabled={isDisabled}
            titleOverride={customTitle}
          />
        );
      })}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Camera view                                                         */
/* ------------------------------------------------------------------ */

function CameraView() {
  const { camera } = useEvaluatedValues();
  const setCameraValue = useStudio((s) => s.setCameraValue);
  const setCameraValues = useStudio((s) => s.setCameraValues);
  const dofEnabled = useStudio((s) => s.sceneSettings.dofEnabled);
  const focusTarget = useStudio((s) => s.sceneSettings.focusTarget);
  const focusLocked = useStudio((s) => s.sceneSettings.focusLocked);
  const setSceneSettings = useStudio((s) => s.setSceneSettings);
  const setFocusLocked = useStudio((s) => s.setFocusLocked);
  const clearFocusTarget = useStudio((s) => s.clearFocusTarget);
  const setTool = useStudio((s) => s.setTool);
  const bundle = useStudio((s) => s.bundle);
  const defs = channelsForTarget('camera');

  const targetLayer = focusTarget && bundle
    ? bundle.layers.find((l) => l.id === focusTarget.layerId) ?? null
    : null;
  const targetLabel = targetLayer
    ? targetLayer.role === 'background'
      ? 'Fond'
      : targetLayer.label
    : null;

  const flatView = () => {
    const b = useStudio.getState().bundle;
    if (!b) return;
    applyFit((r, fov) => ({ ...r.fitCamera(b, fov), orbitX: 0, orbitY: 0, roll: 0 }));
  };
  const perspective = () => setCameraValues({ orbitX: 16, orbitY: -22 });
  const refit = () => {
    const b = useStudio.getState().bundle;
    if (!b) return;
    applyFit((r, fov) => r.fitAll(b, fov));
  };

  return (
    <div className="inspector-body">
      <div className="row-actions">
        <button type="button" className="btn" onClick={flatView} disabled={!bundle} title="Caméra face à la page">
          <RectangleHorizontal size={13} />
          À plat
        </button>
        <button type="button" className="btn" onClick={perspective} disabled={!bundle} title="Tilt 16°, pan -22°">
          <Box size={13} />
          Perspective
        </button>
        <button type="button" className="btn" onClick={refit} disabled={!bundle} title="Cadrer toutes les couches">
          <Crosshair size={13} />
          Recadrer
        </button>
      </div>

      {groupsForTarget('camera').map((group) => (
        <ChannelGroupSection
          key={group}
          group={group}
          defs={defs.filter((d) => d.group === group)}
          valueOf={(def) => camera[def.id as CameraChannelId]}
          onChange={(def, v) => setCameraValue(def.id as CameraChannelId, v)}
          keyTarget={null}
          disabled={
            group === 'lens'
              ? (def) => def.id === 'focus' && Boolean(dofEnabled && focusLocked && focusTarget)
              : false
          }
          titleOverride={
            group === 'lens'
              ? (def) =>
                  def.id === 'focus' && dofEnabled && focusLocked && focusTarget
                    ? 'Piloté par la cible verrouillée'
                    : undefined
              : undefined
          }
          extra={
            group === 'lens' ? (
              <Toggle
                label="Profondeur de champ"
                checked={dofEnabled}
                onChange={(v) => setSceneSettings({ dofEnabled: v })}
              />
            ) : undefined
          }
          footer={
            group === 'lens' && dofEnabled ? (
                  <div className="focus-target-box">
                    <div className="focus-target-row">
                      <span className="focus-target-meta">Cible</span>
                      <span
                        className={`focus-target-label${!targetLabel ? ' empty' : ''}`}
                        title={targetLabel ?? 'Aucune — cliquez avec l’outil Mise au point (F)'}
                      >
                        {targetLabel ?? 'Aucune — cliquez avec l’outil Mise au point (F)'}
                      </span>
                      {focusTarget && (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={clearFocusTarget}
                          title="Retirer la cible"
                          aria-label="Retirer la cible"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="focus-target-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setTool('focus')}
                        title="Viser un point dans le viewport (F)"
                      >
                        <Focus size={13} />
                        Viser
                      </button>
                      <Toggle
                        label="Verrouillée"
                        checked={focusLocked}
                        disabled={!focusTarget}
                        title="Force la mise au point sur ce point pendant toute l'animation"
                        onChange={(v) => setFocusLocked(v)}
                      />
                    </div>
                  </div>
            ) : undefined
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene view                                                          */
/* ------------------------------------------------------------------ */

function SceneView() {
  const { scene } = useEvaluatedValues();
  const setSceneValue = useStudio((s) => s.setSceneValue);
  const lightEnabled = useStudio((s) => s.sceneSettings.lightEnabled);
  const setSceneSettings = useStudio((s) => s.setSceneSettings);
  const bundle = useStudio((s) => s.bundle);
  const layers = useStudio((s) => s.layers);
  const setLayerFlags = useStudio((s) => s.setLayerFlags);
  const defs = channelsForTarget('scene');

  const bgLayer = bundle?.layers.find((l) => l.role === 'background') ?? null;
  const bgColor = bgLayer ? layers[bgLayer.id]?.backgroundColor ?? bgLayer.backgroundColor ?? '#ffffff' : null;

  return (
    <div className="inspector-body">
      {bgLayer && bgColor !== null && (
        <Section title="Fond">
          <ColorField
            label="Couleur"
            value={bgColor}
            onChange={(color) => setLayerFlags(bgLayer.id, { backgroundColor: color })}
          />
        </Section>
      )}

      {groupsForTarget('scene').map((group) => (
        <ChannelGroupSection
          key={group}
          group={group}
          defs={defs.filter((d) => d.group === group)}
          valueOf={(def) => scene[def.id as SceneChannelId]}
          onChange={(def, v) => setSceneValue(def.id as SceneChannelId, v)}
          keyTarget={null}
          disabled={group === 'light' && !lightEnabled}
          extra={
            group === 'light' ? (
              <Toggle
                label="Activée"
                checked={lightEnabled}
                onChange={(v) => setSceneSettings({ lightEnabled: v })}
              />
            ) : undefined
          }
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Frame view                                                          */
/* ------------------------------------------------------------------ */

const FORMAT_NAMES = Object.keys(FRAME_FORMATS) as Exclude<FrameFormatName, 'custom'>[];

const GUIDE_OPTIONS: readonly SegmentedOption<FrameState['guides']>[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'thirds', label: 'Tiers' },
  { value: 'center', label: 'Centre' },
  { value: 'grid', label: 'Grille' },
];

function FrameView() {
  const frame = useStudio((s) => s.frame);
  const setFrame = useStudio((s) => s.setFrame);
  const setFrameFormat = useStudio((s) => s.setFrameFormat);
  const swapFrameOrientation = useStudio((s) => s.swapFrameOrientation);

  return (
    <div className="inspector-body">
      <Section title="Format">
        <div className="format-grid">
          {FORMAT_NAMES.map((name) => {
            const preset = FRAME_FORMATS[name];
            return (
              <button
                key={name}
                type="button"
                className={frame.format === name ? 'format-btn active' : 'format-btn'}
                onClick={() => setFrameFormat(name)}
                aria-pressed={frame.format === name}
              >
                <span>{preset.label}</span>
                <span className="dims">
                  {preset.width} × {preset.height}
                </span>
              </button>
            );
          })}
        </div>
        <button type="button" className="btn btn-block" onClick={swapFrameOrientation} title="Inverser largeur et hauteur">
          <RotateCw size={13} />
          Inverser l'orientation
        </button>
      </Section>

      <Section title="Dimensions">
        <div className="prop-row no-key">
          <NumberField
            label="Largeur"
            value={frame.width}
            onChange={(v) => setFrame({ width: Math.round(v / 2) * 2 })}
            step={2}
            precision={0}
            min={240}
            max={4096}
            unit="px"
          />
        </div>
        <div className="prop-row no-key">
          <NumberField
            label="Hauteur"
            value={frame.height}
            onChange={(v) => setFrame({ height: Math.round(v / 2) * 2 })}
            step={2}
            precision={0}
            min={240}
            max={4096}
            unit="px"
          />
        </div>
        <div className="hint">
          Format actif : <span className="mono">{frame.format === 'custom' ? 'personnalisé' : FRAME_FORMATS[frame.format].label}</span>
        </div>
      </Section>

      <Section title="Repères">
        <Segmented
          value={frame.guides}
          options={GUIDE_OPTIONS}
          onChange={(guides) => setFrame({ guides })}
          block
          ariaLabel="Repères de composition"
        />
      </Section>

      <Section title="Hors-cadre">
        <Toggle
          label="Afficher le hors-cadre"
          checked={frame.showOverscan}
          onChange={(v) => setFrame({ showOverscan: v })}
        />
        <div className="prop-row no-key">
          <span className="prop-label static">Assombrissement</span>
          <div className="slider-row">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={Math.round(frame.maskOpacity * 100)}
              disabled={!frame.showOverscan}
              aria-label="Assombrissement du hors-cadre"
              onChange={(e) => setFrame({ maskOpacity: Number(e.target.value) / 100 })}
            />
            <NumberField
              value={Math.round(frame.maskOpacity * 100)}
              onChange={(v) => setFrame({ maskOpacity: v / 100 })}
              step={1}
              precision={0}
              min={0}
              max={100}
              unit="%"
              disabled={!frame.showOverscan}
            />
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Export view                                                         */
/* ------------------------------------------------------------------ */

const BLUR_OPTIONS: readonly SegmentedOption<'1' | '2' | '4' | '8'>[] = [
  { value: '1', label: 'Off' },
  { value: '2', label: '2×' },
  { value: '4', label: '4×' },
  { value: '8', label: '8×' },
];

function ExportView() {
  const exporting = useStudio((s) => s.exporting);
  const progress = useStudio((s) => s.exportProgress);
  const setError = useStudio((s) => s.setError);
  const exportQuality = useStudio((s) => s.exportQuality);
  const setExportQuality = useStudio((s) => s.setExportQuality);
  const motionBlurSamples = useStudio((s) => s.motionBlurSamples);
  const setMotionBlurSamples = useStudio((s) => s.setMotionBlurSamples);
  const frame = useStudio((s) => s.frame);
  const duration = useStudio((s) => s.duration);
  const bundle = useStudio((s) => s.bundle);

  // The frame decides the aspect, the quality only scales it, so the real
  // output size is worth stating explicitly.
  const quality = EXPORT_QUALITIES[exportQuality];
  const outputSize = resolveExportSize(frame, quality.scale);
  const blurValue = ([1, 2, 4, 8] as const).includes(motionBlurSamples as 1 | 2 | 4 | 8)
    ? (String(motionBlurSamples) as '1' | '2' | '4' | '8')
    : '1';

  async function onExport() {
    try {
      const res = await runExport();
      downloadBlob(res.blob, `diorama-${Date.now()}.mp4`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="inspector-body">
      <Section title="Qualité">
        <div className="prop-row no-key">
          <span className="prop-label static">Préréglage</span>
          <select
            className="select"
            value={exportQuality}
            disabled={exporting}
            aria-label="Qualité d'export"
            onChange={(e) => setExportQuality(e.target.value as ExportQualityName)}
          >
            {(Object.keys(EXPORT_QUALITIES) as ExportQualityName[]).map((name) => (
              <option key={name} value={name}>
                {EXPORT_QUALITIES[name].label}
              </option>
            ))}
          </select>
        </div>
        <div className="prop-row no-key">
          <span className="prop-label static">Motion blur</span>
          <Segmented
            value={blurValue}
            options={BLUR_OPTIONS}
            disabled={exporting}
            onChange={(v) => setMotionBlurSamples(Number(v))}
            block
            ariaLabel="Échantillons de motion blur"
          />
        </div>
      </Section>

      <Section title="Sortie">
        <div className="hint">
          Taille : <span className="mono">{outputSize.width} × {outputSize.height}</span>
        </div>
        <div className="hint">
          Durée : <span className="mono">{duration.toFixed(1)} s</span> à <span className="mono">{quality.fps} fps</span>
          {' '}(<span className="mono">{Math.max(1, Math.round(duration * quality.fps))}</span> images)
        </div>
        <div className="hint">
          Débit : <span className="mono">{(quality.bitrate / 1_000_000).toFixed(0)} Mb/s</span>
        </div>
      </Section>

      <div className="stack">
        <button type="button" className="btn btn-accent btn-block" onClick={() => void onExport()} disabled={exporting || !bundle}>
          <Download size={13} />
          {exporting ? `Export ${Math.round(progress * 100)} %` : 'Exporter en MP4'}
        </button>
        {exporting && (
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <div style={{ width: `${progress * 100}%` }} />
          </div>
        )}
        <div className="hint">Gardez cet onglet au premier plan pendant l'export : Chromium ne peint pas les onglets en arrière-plan.</div>
      </div>
    </div>
  );
}
