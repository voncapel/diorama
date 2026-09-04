import type { PresetId, PresetInfo } from '../../shared/agentProtocol';
import type { CameraValues, LayerValues } from '../model/channels';
import type { Easing, Keyframe } from '../model/timeline';
import { makeKeyframe } from '../model/timeline';

export interface PresetContext {
  /** Zap layer ids, already in stagger order. */
  zapLayerIds: string[];
  baseDistance: number;
  duration: number;
  baseCamera: CameraValues;
  layerRects: Record<string, { cx: number; cy: number; w: number; h: number }>;
  layerZ?: Record<string, number>;
  layerBase?: Record<string, LayerValues>;
  animatedChannels?: Record<string, string[]>;
}

export interface PresetDef {
  id: PresetId;
  description: string;
  scope: 'camera' | 'layers' | 'both';
  params: { name: string; default: number | string; description: string }[];
  build(
    ctx: PresetContext,
    at: number,
    params: Record<string, number | string>,
    layerIds: string[],
  ): Keyframe[];
}

function clampT(t: number, duration: number): number {
  return Math.min(duration, Math.max(0, t));
}

function asNum(v: number | string | undefined, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (typeof v === 'string') {
    const parsed = Number.parseFloat(v);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asStr(v: number | string | undefined, fallback: string): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return fallback;
}

export const PRESET_LIBRARY: PresetDef[] = [
  {
    id: 'dolly-in',
    description: 'Rapprochement caméra en travelling avant dynamique',
    scope: 'camera',
    params: [
      { name: 'from', default: 1.0, description: 'Multiplicateur distance de départ' },
      { name: 'to', default: 0.85, description: 'Multiplicateur distance de fin' },
      { name: 'length', default: 3.2, description: 'Durée du mouvement en secondes' },
      { name: 'easing', default: 'expo.out', description: 'Courbe d’accélération' },
    ],
    build(ctx, at, params) {
      const from = asNum(params.from, 1.0);
      const to = asNum(params.to, 0.85);
      const length = asNum(params.length, 3.2);
      const easing = asStr(params.easing, 'expo.out') as Easing;
      const t0 = clampT(at, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);
      return [
        makeKeyframe(null, 'distance', t0, ctx.baseCamera.distance * from, 'linear'),
        makeKeyframe(null, 'distance', t1, ctx.baseCamera.distance * to, easing),
      ];
    },
  },
  {
    id: 'dolly-out',
    description: 'Recul caméra pour révéler l’ensemble de la scène',
    scope: 'camera',
    params: [
      { name: 'from', default: 0.85, description: 'Multiplicateur distance de départ' },
      { name: 'to', default: 1.0, description: 'Multiplicateur distance de fin' },
      { name: 'length', default: 3.2, description: 'Durée du mouvement en secondes' },
      { name: 'easing', default: 'quart.out', description: 'Courbe d’accélération' },
    ],
    build(ctx, at, params) {
      const from = asNum(params.from, 0.85);
      const to = asNum(params.to, 1.0);
      const length = asNum(params.length, 3.2);
      const easing = asStr(params.easing, 'quart.out') as Easing;
      const t0 = clampT(at, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);
      return [
        makeKeyframe(null, 'distance', t0, ctx.baseCamera.distance * from, 'linear'),
        makeKeyframe(null, 'distance', t1, ctx.baseCamera.distance * to, easing),
      ];
    },
  },
  {
    id: 'orbit-reveal',
    description: 'Rotation d’orbite révélant la composition sous un nouvel angle',
    scope: 'camera',
    params: [
      { name: 'fromX', default: 10, description: 'Tilt de départ en degrés' },
      { name: 'toX', default: 0, description: 'Tilt d’arrivée en degrés' },
      { name: 'fromY', default: -24, description: 'Pan de départ en degrés' },
      { name: 'toY', default: -6, description: 'Pan d’arrivée en degrés' },
      { name: 'length', default: 4, description: 'Durée de rotation en secondes' },
      { name: 'easing', default: 'quint.inOut', description: 'Courbe d’accélération' },
    ],
    build(ctx, at, params) {
      const fromX = asNum(params.fromX, 10);
      const toX = asNum(params.toX, 0);
      const fromY = asNum(params.fromY, -24);
      const toY = asNum(params.toY, -6);
      const length = asNum(params.length, 4);
      const easing = asStr(params.easing, 'quint.inOut') as Easing;
      const t0 = clampT(at, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);
      return [
        makeKeyframe(null, 'orbitX', t0, fromX, 'linear'),
        makeKeyframe(null, 'orbitX', t1, toX, easing),
        makeKeyframe(null, 'orbitY', t0, fromY, 'linear'),
        makeKeyframe(null, 'orbitY', t1, toY, easing),
      ];
    },
  },
  {
    id: 'push-tilt',
    description: 'Avancée caméra combinée à une bascule verticale (tilt)',
    scope: 'camera',
    params: [
      { name: 'from', default: 1.0, description: 'Multiplicateur distance de départ' },
      { name: 'to', default: 0.8, description: 'Multiplicateur distance de fin' },
      { name: 'tilt', default: 12, description: 'Tilt d’arrivée en degrés' },
      { name: 'length', default: 3, description: 'Durée en secondes' },
      { name: 'easing', default: 'cubic.inOut', description: 'Courbe d’accélération' },
    ],
    build(ctx, at, params) {
      const from = asNum(params.from, 1.0);
      const to = asNum(params.to, 0.8);
      const tilt = asNum(params.tilt, 12);
      const length = asNum(params.length, 3);
      const easing = asStr(params.easing, 'cubic.inOut') as Easing;
      const t0 = clampT(at, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);
      return [
        makeKeyframe(null, 'distance', t0, ctx.baseCamera.distance * from, 'linear'),
        makeKeyframe(null, 'distance', t1, ctx.baseCamera.distance * to, easing),
        makeKeyframe(null, 'orbitX', t0, 0, 'linear'),
        makeKeyframe(null, 'orbitX', t1, tilt, easing),
      ];
    },
  },
  {
    id: 'whip-pan',
    description: 'Balayage horizontal ultrarapide avec amorce de roulis',
    scope: 'camera',
    params: [
      { name: 'from', default: -20, description: 'Pan de départ en degrés' },
      { name: 'to', default: 20, description: 'Pan d’arrivée en degrés' },
      { name: 'length', default: 0.6, description: 'Durée rapide en secondes' },
      { name: 'easing', default: 'quint.inOut', description: 'Courbe d’accélération' },
    ],
    build(ctx, at, params) {
      const from = asNum(params.from, -20);
      const to = asNum(params.to, 20);
      const length = asNum(params.length, 0.6);
      const easing = asStr(params.easing, 'quint.inOut') as Easing;
      const t0 = clampT(at, ctx.duration);
      const tMid = clampT(at + length / 2, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);
      return [
        makeKeyframe(null, 'orbitY', t0, from, 'linear'),
        makeKeyframe(null, 'orbitY', t1, to, easing),
        makeKeyframe(null, 'roll', t0, 0, 'linear'),
        makeKeyframe(null, 'roll', tMid, 2, 'quart.out'),
        makeKeyframe(null, 'roll', t1, 0, 'quart.out'),
      ];
    },
  },
  {
    id: 'rack-focus',
    description: 'Bascule de mise au point nette d’un plan à un autre (DoF)',
    scope: 'both',
    params: [
      { name: 'focusFrom', default: 'background', description: 'Couche source ou "background"' },
      { name: 'focusTo', default: '', description: 'Couche cible du focus' },
      { name: 'length', default: 1.6, description: 'Durée du rack focus' },
      { name: 'aperture', default: 3, description: 'Ouverture du diaphragme' },
    ],
    build(ctx, at, params, layerIds) {
      const focusFrom = asStr(params.focusFrom, 'background');
      let focusTo = asStr(params.focusTo, '');
      if (!focusTo && layerIds.length > 0) {
        focusTo = layerIds[0] ?? '';
      }
      const length = asNum(params.length, 1.6);
      const aperture = asNum(params.aperture, 3);
      const t0 = clampT(at, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);

      const zOf = (target: string): number => {
        if (target === 'background') return 0;
        if (ctx.layerZ && typeof ctx.layerZ[target] === 'number') {
          return ctx.layerZ[target]!;
        }
        if (ctx.layerBase && ctx.layerBase[target]?.z !== undefined) {
          return ctx.layerBase[target]!.z;
        }
        return 60;
      };

      const distFrom = ctx.baseCamera.distance - zOf(focusFrom);
      const distTo = ctx.baseCamera.distance - zOf(focusTo);

      return [
        makeKeyframe(null, 'focus', t0, distFrom, 'linear'),
        makeKeyframe(null, 'focus', t1, distTo, 'cubic.inOut'),
        makeKeyframe(null, 'aperture', t0, 0, 'linear'),
        makeKeyframe(null, 'aperture', t1, aperture, 'cubic.inOut'),
      ];
    },
  },
  {
    id: 'stagger-cascade',
    description: 'Déploiement échelonné des couches en translation ou profondeur',
    scope: 'layers',
    params: [
      { name: 'axis', default: 'z', description: 'Axe de déploiement (z, y, x)' },
      { name: 'distance', default: 0, description: 'Distance parcourue (défaut baseDistance * 0.06)' },
      { name: 'delay', default: 0.08, description: 'Délai entre couches en secondes' },
      { name: 'length', default: 1.1, description: 'Durée par couche en secondes' },
      { name: 'fade', default: 1, description: 'Fondu d’opacité initial (0 ou 1)' },
    ],
    build(ctx, at, params, layerIds) {
      const axis = (asStr(params.axis, 'z').toLowerCase() as 'x' | 'y' | 'z') || 'z';
      const defaultDist = ctx.baseDistance * 0.06;
      const rawDistance = asNum(params.distance, 0);
      const distance = rawDistance !== 0 ? rawDistance : defaultDist;
      const delay = asNum(params.delay, 0.08);
      const length = asNum(params.length, 1.1);
      const fade = asNum(params.fade, 1) === 1;

      const targets = layerIds.length > 0 ? layerIds : ctx.zapLayerIds;
      const out: Keyframe[] = [];

      targets.forEach((id, i) => {
        const start = clampT(at + i * delay, ctx.duration);
        const end = clampT(start + length, ctx.duration);

        if (axis === 'z') {
          out.push(makeKeyframe(id, 'z', start, 0, 'linear'));
          out.push(makeKeyframe(id, 'z', end, distance, 'back.out'));
        } else if (axis === 'y' || axis === 'x') {
          const channel = axis;
          out.push(makeKeyframe(id, channel, start, distance, 'linear'));
          out.push(makeKeyframe(id, channel, end, 0, 'back.out'));
        }

        if (fade) {
          const fadeEnd = clampT(start + 0.5, ctx.duration);
          out.push(makeKeyframe(id, 'opacity', start, 0, 'linear'));
          out.push(makeKeyframe(id, 'opacity', fadeEnd, 100, 'cubic.inOut'));
        }
      });

      return out;
    },
  },
  {
    id: 'parallax-drift',
    description: 'Dérive subtile parallaxe alternée gauche-droite avec compensation caméra',
    scope: 'both',
    params: [
      { name: 'amplitude', default: 24, description: 'Amplitude du décalage en pixels' },
      { name: 'length', default: 0, description: 'Durée (défaut = durée totale)' },
    ],
    build(ctx, at, params, layerIds) {
      const amplitude = asNum(params.amplitude, 24);
      const lengthParam = asNum(params.length, 0);
      const length = lengthParam > 0 ? lengthParam : ctx.duration;
      const t0 = clampT(at, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);

      const targets = layerIds.length > 0 ? layerIds : ctx.zapLayerIds;
      const out: Keyframe[] = [];

      targets.forEach((id, i) => {
        const sign = i % 2 === 0 ? 1 : -1;
        out.push(makeKeyframe(id, 'x', t0, -amplitude * sign, 'linear'));
        out.push(makeKeyframe(id, 'x', t1, amplitude * sign, 'linear'));
      });

      out.push(makeKeyframe(null, 'orbitY', t0, -3, 'linear'));
      out.push(makeKeyframe(null, 'orbitY', t1, 3, 'linear'));

      return out;
    },
  },
  {
    id: 'hero-lift',
    description: 'Élévation marquée de la couche principale avec zoom et bascule d’orbite',
    scope: 'layers',
    params: [
      { name: 'distance', default: 0, description: 'Hauteur en Z (défaut baseDistance * 0.12)' },
      { name: 'length', default: 1.6, description: 'Durée en secondes' },
      { name: 'orbit', default: 7, description: 'Angle orbitY d’accompagnement' },
      { name: 'scale', default: 104, description: 'Échelle finale de la couche en %' },
    ],
    build(ctx, at, params, layerIds) {
      const targets = layerIds.length > 0 ? layerIds : ctx.zapLayerIds;
      const hero = targets[0];
      if (!hero) return [];

      const defaultDist = ctx.baseDistance * 0.12;
      const rawDist = asNum(params.distance, 0);
      const distance = rawDist !== 0 ? rawDist : defaultDist;
      const length = asNum(params.length, 1.6);
      const orbit = asNum(params.orbit, 7);
      const scaleVal = asNum(params.scale, 104);

      const t0 = clampT(at, ctx.duration);
      const t1 = clampT(at + length, ctx.duration);

      return [
        makeKeyframe(hero, 'z', t0, 0, 'linear'),
        makeKeyframe(hero, 'z', t1, distance, 'expo.out'),
        makeKeyframe(hero, 'scale', t0, 100, 'linear'),
        makeKeyframe(hero, 'scale', t1, scaleVal, 'expo.out'),
        makeKeyframe(null, 'orbitY', t0, 0, 'linear'),
        makeKeyframe(null, 'orbitY', t1, orbit, 'cubic.inOut'),
      ];
    },
  },
  {
    id: 'settle',
    description: 'Retour amorti de toutes les couches animées à leur position de repos',
    scope: 'layers',
    params: [
      { name: 'length', default: 0.8, description: 'Durée du retour en secondes' },
      { name: 'easing', default: 'quart.out', description: 'Courbe d’amorti' },
    ],
    build(ctx, at, params, layerIds) {
      const length = asNum(params.length, 0.8);
      const easing = asStr(params.easing, 'quart.out') as Easing;
      const t1 = clampT(at + length, ctx.duration);

      const targets = layerIds.length > 0 ? layerIds : ctx.zapLayerIds;
      const out: Keyframe[] = [];

      const settleChannels: (keyof LayerValues)[] = ['z', 'x', 'y', 'scale', 'opacity'];

      targets.forEach((id) => {
        const animated = ctx.animatedChannels?.[id] ?? [];
        const baseVals = ctx.layerBase?.[id];
        settleChannels.forEach((ch) => {
          if (animated.includes(ch)) {
            const val = baseVals ? baseVals[ch] : ch === 'scale' || ch === 'opacity' ? 100 : 0;
            out.push(makeKeyframe(id, ch, t1, val, easing));
          }
        });
      });

      return out;
    },
  },
];

export function presetInfos(): PresetInfo[] {
  return PRESET_LIBRARY.map((p) => ({
    id: p.id,
    description: p.description,
    params: p.params.map((param) => ({
      name: param.name,
      default: param.default,
      description: param.description,
    })),
    scope: p.scope,
  }));
}

export function applyPreset(
  id: PresetId,
  ctx: PresetContext,
  at = 0,
  params: Record<string, number | string> = {},
  layerIds: string[] = [],
): Keyframe[] {
  const def = PRESET_LIBRARY.find((p) => p.id === id);
  if (!def) {
    throw new Error(`Preset inconnu: ${id}`);
  }
  return def.build(ctx, at, params, layerIds);
}

/**
 * MVP Director: local preset assembly, no LLM call.
 * Rewritten on top of PRESET_LIBRARY.
 */
export function directLocal(ctx: PresetContext, prompt: string): Keyframe[] {
  const wantsHero = /hero|décoll|decoll|lift|détach|detach/i.test(prompt);
  const kfs: Keyframe[] = [];

  kfs.push(...applyPreset('dolly-in', ctx, 0, { from: 1.0, to: 0.88, length: 3.2 }));
  kfs.push(...applyPreset('stagger-cascade', ctx, 0.4, { delay: 0.08, length: 1.1 }));
  if (wantsHero) {
    kfs.push(...applyPreset('hero-lift', ctx, 0.2, { length: 1.6 }));
  }
  return kfs;
}
