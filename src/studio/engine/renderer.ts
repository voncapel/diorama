import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { CaptureBundle, CaptureLayer } from '../../shared/types';
import type { BuiltScene } from './sceneBuilder';
import { PaintRecordUnavailableError } from './sceneBuilder';
import { fitRectInFrame } from './frame';
import type { WorldRect } from './frame';
import type { CameraValues, LayerValues, SceneValues } from '../model/channels';
import { DEFAULT_CAMERA_VALUES } from '../model/channels';
import type { LayerState, SceneSettings } from '../store';

/**
 * The experimental call, isolated on purpose.
 *
 * There is no WebGL upload path in the shipped API: an ElementImage can only be
 * drawn through a 2D context, and only into the very canvas it was captured
 * from. So we snapshot into the host, then blit the region into a per-layer
 * scratch canvas that Three.js consumes as a CanvasTexture source.
 */
export function uploadElementTexture(
  host: HTMLCanvasElement,
  hostCtx: CanvasRenderingContext2D,
  scratchCtx: CanvasRenderingContext2D,
  element: Element,
  width: number,
  height: number,
): void {
  let image: ElementImage;
  try {
    image = host.captureElementImage(element);
  } catch (err) {
    // Missing paint record: the tab was backgrounded, nothing was ever painted.
    throw new PaintRecordUnavailableError(err);
  }
  hostCtx.clearRect(0, 0, host.width, host.height);
  hostCtx.drawElementImage(image, 0, 0);

  scratchCtx.clearRect(0, 0, width, height);
  scratchCtx.drawImage(host, 0, 0, width, height, 0, 0, width, height);
}

export interface LayerObject {
  layer: CaptureLayer;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>;
  basicMaterial: THREE.MeshBasicMaterial;
  lambertMaterial: THREE.MeshLambertMaterial;
  texture?: THREE.CanvasTexture;
  /** Per-layer scratch canvas, reused across frames. */
  scratch?: HTMLCanvasElement;
  scratchCtx?: CanvasRenderingContext2D;
  width: number;
  height: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  origPositions: Float32Array;
  /** Background layers keep alphaTest at 0; zap layers cut out at 0.02. */
  cutout: number;
}

const DEG2RAD = Math.PI / 180;

export class WebGLUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      'WebGL est indisponible dans ce navigateur. Vérifiez chrome://gpu (accélération matérielle désactivée ou processus GPU bloqué), relancez Chrome, ou lancez-le sans --disable-gpu.',
      options,
    );
    this.name = 'WebGLUnavailableError';
  }
}

/** 1 CSS pixel = 1 world unit; the scene is centred on the page. */
export class DioramaRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly gl: WebGL2RenderingContext;
  readonly layers = new Map<string, LayerObject>();

  private contextLost = false;
  private onContextLost = (ev: Event) => {
    ev.preventDefault();
    this.contextLost = true;
  };
  private onContextRestored = () => {
    this.contextLost = false;
  };

  get isContextLost(): boolean {
    return this.contextLost;
  }

  private directionalLight: THREE.DirectionalLight | null = null;
  private ambientLight: THREE.AmbientLight | null = null;
  private lightEnabled = true;

  private dummy = new THREE.Texture();

  private composer: EffectComposer | null = null;
  private bokeh: BokehPass | null = null;
  private fxaa: FXAAPass | null = null;
  private dofEnabled = false;
  /** Kept so a composer created lazily can be sized like the current target. */
  private targetSize = { width: 1, height: 1 };
  /**
   * The camera framing follows the composition frame, never the canvas: the
   * on-screen canvas is letterboxed to this aspect, so preview and export show
   * exactly the same picture whatever the panel size.
   */
  private frameAspect = 16 / 9;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    if (!gl) {
      throw new WebGLUnavailableError();
    }

    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        context: gl,
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
      });
    } catch (err) {
      throw new WebGLUnavailableError({ cause: err });
    }

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x000000, 0);

    const ctx = this.renderer.getContext();
    if (!(ctx instanceof WebGL2RenderingContext)) {
      throw new Error('WebGL2 requis');
    }
    this.gl = ctx;

    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      DEFAULT_CAMERA_VALUES.fov,
      canvas.clientWidth / Math.max(1, canvas.clientHeight),
      1,
      200000,
    );
    this.camera.position.set(0, 0, DEFAULT_CAMERA_VALUES.distance);
  }

  setFrameAspect(aspect: number) {
    this.frameAspect = Math.max(aspect, Number.EPSILON);
    this.camera.aspect = this.frameAspect;
    this.camera.updateProjectionMatrix();
  }

  /** Builds one plane mesh per layer and uploads its element snapshot. */
  async buildLayers(
    bundle: CaptureBundle,
    built: BuiltScene,
    layers?: Record<string, LayerState>,
    isCancelled?: () => boolean,
  ) {
    this.disposeLayers();

    const bg = bundle.layers.find((l) => l.role === 'background');
    const cx = (bg?.rect.w ?? bundle.viewport.width) / 2;
    const cy = (bg?.rect.h ?? bundle.viewport.height) / 2;

    for (const layer of bundle.layers) {
      if (isCancelled?.()) return;
      const element = built.elements.get(layer.id);
      if (!element) continue;

      // Prefer the rect measured in the rebuilt scene
      const rect = built.rects.get(layer.id) ?? layer.rect;
      const isBackground = layer.role === 'background';
      // Background layer extends edge-to-edge across the entire scene/frame
      const width = isBackground ? 100000 : Math.max(1, Math.round(rect.w));
      const height = isBackground ? 100000 : Math.max(1, Math.round(rect.h));

      let texture: THREE.CanvasTexture | undefined;
      let scratch: HTMLCanvasElement | undefined;
      let scratchCtx: CanvasRenderingContext2D | undefined;

      if (!isBackground) {
        scratch = this.dummyImage(width, height);
        scratchCtx = scratch.getContext('2d') ?? undefined;
        if (!scratchCtx) throw new Error('Contexte 2D indisponible sur le canvas scratch');

        texture = new THREE.CanvasTexture(scratch);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = true;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.anisotropy = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
        texture.flipY = true;

        try {
          await built.captureLayerTexture(layer.id, scratchCtx, width, height);
        } catch (err) {
          console.warn(`[diorama] Couche ${layer.id} (${layer.label}) ignorée :`, err);
          continue;
        }
        if (isCancelled?.()) return;
        texture.needsUpdate = true;
      }

      const initialColor = isBackground
        ? (layers?.[layer.id]?.backgroundColor ?? layer.backgroundColor ?? '#ffffff')
        : '#ffffff';

      const geometry = new THREE.PlaneGeometry(width, height);
      const posAttr = geometry.attributes.position as THREE.BufferAttribute;
      const origPositions = new Float32Array(posAttr.array);

      const cutout = isBackground ? 0 : 0.02;

      const basicMaterial = new THREE.MeshBasicMaterial({
        map: isBackground ? null : texture,
        color: isBackground ? new THREE.Color(initialColor) : new THREE.Color(0xffffff),
        transparent: true,
        depthWrite: true,
        alphaTest: cutout,
        toneMapped: false,
      });

      const lambertMaterial = new THREE.MeshLambertMaterial({
        map: isBackground ? null : texture,
        emissive: isBackground ? 0x000000 : 0x666666,
        emissiveMap: isBackground ? null : texture,
        color: isBackground ? new THREE.Color(initialColor) : new THREE.Color(0xffffff),
        transparent: true,
        depthWrite: true,
        alphaTest: cutout,
        toneMapped: false,
      });

      const mesh = new THREE.Mesh(geometry, this.lightEnabled ? lambertMaterial : basicMaterial);

      const baseX = isBackground ? 0 : rect.x + rect.w / 2 - cx;
      const baseY = isBackground ? 0 : cy - (rect.y + rect.h / 2);
      const baseZ = isBackground ? 0 : 1 + layer.order;

      // Page coordinates (y down) → world coordinates (y up), centred.
      mesh.position.set(baseX, baseY, baseZ);

      mesh.receiveShadow = true;
      mesh.castShadow = false;

      this.scene.add(mesh);
      this.layers.set(layer.id, {
        layer,
        mesh,
        basicMaterial,
        lambertMaterial,
        texture,
        scratch,
        scratchCtx,
        width,
        height,
        baseX,
        baseY,
        baseZ,
        origPositions,
        cutout,
      });
    }
  }

  private dummyImage(w: number, h: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /** Re-uploads every layer snapshot (after a requestPaint). */
  async refreshTextures(built: BuiltScene) {
    for (const [id, obj] of this.layers) {
      if (obj.layer.role === 'background') continue;
      if (!obj.scratchCtx || !obj.texture) continue;
      await built.captureLayerTexture(
        id,
        obj.scratchCtx,
        obj.width,
        obj.height,
      );
      obj.texture.needsUpdate = true;
    }
  }

  applyCamera(values: CameraValues) {
    this.camera.fov = values.fov;
    const { distance, orbitX, orbitY, roll, targetX, targetY, focus } = values;

    const radOrbitX = orbitX * DEG2RAD;
    const radOrbitY = orbitY * DEG2RAD;
    const radRoll = roll * DEG2RAD;

    this.camera.position.set(
      targetX + distance * Math.sin(radOrbitY) * Math.cos(radOrbitX),
      targetY + distance * Math.sin(radOrbitX),
      distance * Math.cos(radOrbitY) * Math.cos(radOrbitX),
    );

    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(targetX, targetY, 0);

    if (radRoll !== 0) {
      this.camera.rotateZ(radRoll);
    }

    this.camera.updateProjectionMatrix();

    if (this.bokeh) {
      const uniforms = this.bokeh.uniforms as Record<string, { value: number }> | undefined;
      if (uniforms?.focus) {
        uniforms.focus.value = focus;
      }
    }
  }

  applyLayers(values: Record<string, LayerValues>, layers: Record<string, LayerState>) {
    for (const [id, obj] of this.layers) {
      const v = values[id];
      const state = layers[id];
      const isBackground = obj.layer.role === 'background';

      const opacityVal = v ? v.opacity : 100;
      const o = opacityVal / 100;
      const visible = (state?.visible ?? true) && o > 0.001;

      if (isBackground) {
        const bgCol = state?.backgroundColor ?? obj.layer.backgroundColor ?? '#ffffff';
        obj.basicMaterial.color.set(bgCol);
        obj.lambertMaterial.color.set(bgCol);
        obj.mesh.material.opacity = o;
        obj.mesh.visible = visible;
        this.renderer.setClearColor(new THREE.Color(bgCol), visible ? o : 0);
        continue;
      }

      const x = v ? v.x : 0;
      const y = v ? v.y : 0;
      const z = v ? v.z : 0;
      const rotX = v ? v.rotX : 0;
      const rotY = v ? v.rotY : 0;
      const rotZ = v ? v.rotZ : 0;
      const scale = v ? v.scale : 100;
      const anchorX = v ? v.anchorX : 50;
      const anchorY = v ? v.anchorY : 50;

      const s = scale / 100;

      // Position: base + (x, -y, z) and pivot compensation
      // Standard plane center is (0, 0).
      // Pivot in local space: px = (anchorX/100 - 0.5) * width, py = (0.5 - anchorY/100) * height
      // When scaled by s around pivot (px, py), the center shifts by (1 - s) * px, (1 - s) * py.
      const pivotOffsetX = ((anchorX / 100) - 0.5) * obj.width;
      const pivotOffsetY = (0.5 - (anchorY / 100)) * obj.height;

      const shiftX = (1 - s) * pivotOffsetX;
      const shiftY = (1 - s) * pivotOffsetY;

      obj.mesh.position.set(
        obj.baseX + x + shiftX,
        obj.baseY - y + shiftY,
        obj.baseZ + z,
      );

      obj.mesh.rotation.order = 'XYZ';
      obj.mesh.rotation.set(rotX * DEG2RAD, rotY * DEG2RAD, rotZ * DEG2RAD);
      obj.mesh.scale.set(s, s, 1);

      // Distort: modify 4 vertices of PlaneGeometry
      // PlaneGeometry(w, h, 1, 1) has 4 vertices:
      // Index 0: top-left (-w/2, h/2, 0)
      // Index 1: top-right (w/2, h/2, 0)
      // Index 2: bottom-left (-w/2, -h/2, 0)
      // Index 3: bottom-right (w/2, -h/2, 0)
      const tlX = v ? v.tlX : 0;
      const tlY = v ? v.tlY : 0;
      const trX = v ? v.trX : 0;
      const trY = v ? v.trY : 0;
      const brX = v ? v.brX : 0;
      const brY = v ? v.brY : 0;
      const blX = v ? v.blX : 0;
      const blY = v ? v.blY : 0;

      const posAttr = obj.mesh.geometry.attributes.position as THREE.BufferAttribute;
      const posArray = posAttr.array as Float32Array;
      const orig = obj.origPositions;

      // TL: index 0
      posArray[0] = (orig[0] ?? 0) + tlX;
      posArray[1] = (orig[1] ?? 0) - tlY; // y down in UI → y up in geometry
      posArray[2] = orig[2] ?? 0;

      // TR: index 1
      posArray[3] = (orig[3] ?? 0) + trX;
      posArray[4] = (orig[4] ?? 0) - trY;
      posArray[5] = orig[5] ?? 0;

      // BL: index 2
      posArray[6] = (orig[6] ?? 0) + blX;
      posArray[7] = (orig[7] ?? 0) - blY;
      posArray[8] = orig[8] ?? 0;

      // BR: index 3
      posArray[9] = (orig[9] ?? 0) + brX;
      posArray[10] = (orig[10] ?? 0) - brY;
      posArray[11] = orig[11] ?? 0;

      posAttr.needsUpdate = true;

      // Material properties
      const mat = obj.mesh.material;
      mat.opacity = o;
      mat.alphaTest = obj.cutout * o;
      obj.mesh.visible = visible;

      const castShadowFlag = state?.castShadow ?? true;
      obj.mesh.castShadow = castShadowFlag && this.lightEnabled;
      obj.mesh.receiveShadow = true;
    }
  }

  applyScene(values: SceneValues, settings: SceneSettings) {
    this.lightEnabled = settings.lightEnabled;

    if (!this.directionalLight) {
      this.directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      this.directionalLight.castShadow = true;
      this.directionalLight.shadow.mapSize.width = 2048;
      this.directionalLight.shadow.mapSize.height = 2048;
      this.directionalLight.shadow.camera.near = 1;
      this.directionalLight.shadow.camera.far = 10000;
      this.directionalLight.shadow.camera.left = -3000;
      this.directionalLight.shadow.camera.right = 3000;
      this.directionalLight.shadow.camera.top = 3000;
      this.directionalLight.shadow.camera.bottom = -3000;
      this.scene.add(this.directionalLight);
      this.scene.add(this.directionalLight.target);
    }

    if (!this.ambientLight) {
      this.ambientLight = new THREE.AmbientLight(0xffffff, 1);
      this.scene.add(this.ambientLight);
    }

    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    if (!settings.lightEnabled) {
      this.directionalLight.visible = false;
      this.ambientLight.visible = false;
      for (const obj of this.layers.values()) {
        if (obj.mesh.material !== obj.basicMaterial) {
          obj.mesh.material = obj.basicMaterial;
        }
        obj.mesh.castShadow = false;
      }
      return;
    }

    this.directionalLight.visible = true;
    this.ambientLight.visible = true;

    for (const obj of this.layers.values()) {
      if (obj.mesh.material !== obj.lambertMaterial) {
        obj.mesh.material = obj.lambertMaterial;
      }
    }

    const { lightAzimuth, lightElevation, lightIntensity, ambient, shadowSoftness, shadowOpacity } = values;

    const radAzimuth = lightAzimuth * DEG2RAD;
    const radElevation = lightElevation * DEG2RAD;
    const lightDist = 3000;

    this.directionalLight.position.set(
      lightDist * Math.sin(radAzimuth) * Math.cos(radElevation),
      lightDist * Math.sin(radElevation),
      lightDist * Math.cos(radAzimuth) * Math.cos(radElevation),
    );
    this.directionalLight.target.position.set(0, 0, 0);

    this.directionalLight.intensity = lightIntensity / 100;
    this.ambientLight.intensity = ambient / 100;

    this.directionalLight.shadow.radius = shadowSoftness;
    this.directionalLight.shadow.intensity = shadowOpacity / 100;
  }

  /** Built lazily: the direct render path stays free when DoF is never used. */
  private ensureComposer(): EffectComposer {
    if (this.composer) return this.composer;
    const renderTarget = new THREE.WebGLRenderTarget(
      this.targetSize.width,
      this.targetSize.height,
      {
        type: THREE.HalfFloatType,
        samples: 4,
      },
    );
    const composer = new EffectComposer(this.renderer, renderTarget);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const bokeh = new BokehPass(this.scene, this.camera, {
      focus: DEFAULT_CAMERA_VALUES.focus,
      aperture: DEFAULT_CAMERA_VALUES.aperture * 0.00001,
      maxblur: DEFAULT_CAMERA_VALUES.maxBlur * 0.01,
    });
    composer.addPass(bokeh);
    const pr = this.renderer.getPixelRatio();
    const fxaa = new FXAAPass();
    fxaa.setSize(this.targetSize.width * pr, this.targetSize.height * pr);
    composer.addPass(fxaa);
    composer.addPass(new OutputPass());
    composer.setPixelRatio(pr);
    composer.setSize(this.targetSize.width, this.targetSize.height);
    this.composer = composer;
    this.bokeh = bokeh;
    this.fxaa = fxaa;
    return composer;
  }

  setDof(enabled: boolean, focus: number, apertureUi: number, maxBlurUi: number) {
    this.dofEnabled = enabled;
    if (!enabled) return;
    this.ensureComposer();
    const uniforms = this.bokeh?.uniforms as
      | Record<string, { value: number }>
      | undefined;
    if (!uniforms) return;
    uniforms.focus!.value = focus;
    uniforms.aperture!.value = apertureUi * 0.00001;
    uniforms.maxblur!.value = maxBlurUi * 0.01;
  }

  /**
   * Raycast from normalized device coordinates (-1..1),
   * returns the id of the closest visible non-background layer.
   */
  pick(ndcX: number, ndcY: number): string | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const candidates: THREE.Mesh[] = [];
    const meshToId = new Map<THREE.Mesh, string>();

    for (const [id, obj] of this.layers) {
      if (obj.layer.role === 'background') continue;
      if (!obj.mesh.visible) continue;
      candidates.push(obj.mesh);
      meshToId.set(obj.mesh, id);
    }

    const intersects = raycaster.intersectObjects(candidates, false);
    if (intersects.length > 0 && intersects[0]?.object) {
      return meshToId.get(intersects[0].object as THREE.Mesh) ?? null;
    }
    return null;
  }

  /**
   * Raycast from normalized device coordinates (-1..1) including background layer,
   * returns the closest intersection with layerId, UV coordinates and distance from camera.
   */
  pickFocus(ndcX: number, ndcY: number): { layerId: string; u: number; v: number; distance: number } | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    const candidates: THREE.Mesh[] = [];
    const meshToId = new Map<THREE.Mesh, string>();

    for (const [id, obj] of this.layers) {
      if (!obj.mesh.visible) continue;
      candidates.push(obj.mesh);
      meshToId.set(obj.mesh, id);
    }

    const intersects = raycaster.intersectObjects(candidates, false);
    const first = intersects[0];
    if (first && first.object && first.uv) {
      const layerId = meshToId.get(first.object as THREE.Mesh);
      if (layerId) {
        return {
          layerId,
          u: first.uv.x,
          v: first.uv.y,
          distance: first.distance,
        };
      }
    }
    return null;
  }

  /**
   * Reconstructs the local point on a potentially distorted PlaneGeometry
   * by bilinear interpolation of the 4 current vertices, then converts to world space.
   * PlaneGeometry(w, h, 1, 1) indices: 0 = TL, 1 = TR, 2 = BL, 3 = BR.
   * UV convention in Three.js: (0,0)=BL, (1,0)=BR, (0,1)=TL, (1,1)=TR.
   */
  focusPointWorld(layerId: string, u: number, v: number): THREE.Vector3 | null {
    const obj = this.layers.get(layerId);
    if (!obj || !obj.mesh.visible) return null;

    obj.mesh.updateMatrixWorld(true);

    const posAttr = obj.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!posAttr) return null;

    const tlX = posAttr.getX(0);
    const tlY = posAttr.getY(0);
    const tlZ = posAttr.getZ(0);

    const trX = posAttr.getX(1);
    const trY = posAttr.getY(1);
    const trZ = posAttr.getZ(1);

    const blX = posAttr.getX(2);
    const blY = posAttr.getY(2);
    const blZ = posAttr.getZ(2);

    const brX = posAttr.getX(3);
    const brY = posAttr.getY(3);
    const brZ = posAttr.getZ(3);

    // Bilinear interpolation in local space:
    // v = 0 -> bottom edge (between BL and BR)
    // v = 1 -> top edge (between TL and TR)
    // u = 0 -> left edge, u = 1 -> right edge
    const bottomX = blX + u * (brX - blX);
    const bottomY = blY + u * (brY - blY);
    const bottomZ = blZ + u * (brZ - blZ);

    const topX = tlX + u * (trX - tlX);
    const topY = tlY + u * (trY - tlY);
    const topZ = tlZ + u * (trZ - tlZ);

    const localX = bottomX + v * (topX - bottomX);
    const localY = bottomY + v * (topY - bottomY);
    const localZ = bottomZ + v * (topZ - bottomZ);

    const worldPoint = new THREE.Vector3(localX, localY, localZ);
    worldPoint.applyMatrix4(obj.mesh.matrixWorld);
    return worldPoint;
  }

  /**
   * Distance from camera.position to the target focus point.
   */
  focusDistanceTo(layerId: string, u: number, v: number): number | null {
    const pt = this.focusPointWorld(layerId, u, v);
    if (!pt) return null;
    return this.camera.position.distanceTo(pt);
  }

  /**
   * Projects the target focus point to screen pixel coordinates {x, y}.
   */
  focusPointScreen(
    layerId: string,
    u: number,
    v: number,
    width: number,
    height: number,
  ): { x: number; y: number } | null {
    const pt = this.focusPointWorld(layerId, u, v);
    if (!pt) return null;

    const projected = pt.clone().project(this.camera);
    // Behind camera check
    if (projected.z > 1) return null;

    return {
      x: ((projected.x + 1) / 2) * width,
      y: ((1 - projected.y) / 2) * height,
    };
  }

  /**
   * Projects the 4 corners of a layer mesh to screen pixel coordinates [tl, tr, br, bl].
   */
  layerScreenQuad(
    id: string,
    width: number,
    height: number,
  ): { x: number; y: number }[] | null {
    const obj = this.layers.get(id);
    if (!obj || !obj.mesh.visible) return null;

    obj.mesh.updateMatrixWorld(true);

    // PlaneGeometry vertices:
    // 0: TL, 1: TR, 2: BL, 3: BR
    const posAttr = obj.mesh.geometry.attributes.position as THREE.BufferAttribute | undefined;
    if (!posAttr) return null;
    const getVertex = (idx: number) => {
      const v = new THREE.Vector3(
        posAttr.getX(idx),
        posAttr.getY(idx),
        posAttr.getZ(idx),
      );
      v.applyMatrix4(obj.mesh.matrixWorld);
      v.project(this.camera);
      // NDC to pixel: (-1..1) -> (0..width, 0..height with y inverted)
      return {
        x: ((v.x + 1) / 2) * width,
        y: ((1 - v.y) / 2) * height,
      };
    };

    const tl = getVertex(0);
    const tr = getVertex(1);
    const bl = getVertex(2);
    const br = getVertex(3);

    // Expected order: tl, tr, br, bl
    return [tl, tr, br, bl];
  }

  /**
   * Public world rect of a layer from its current mesh position.
   */
  layerWorldRect(id: string): WorldRect | null {
    const obj = this.layers.get(id);
    if (!obj) return null;
    if (obj.layer.role === 'background') {
      return { cx: 0, cy: 0, w: obj.width, h: obj.height };
    }
    return {
      cx: obj.mesh.position.x,
      cy: obj.mesh.position.y,
      w: obj.width * obj.mesh.scale.x,
      h: obj.height * obj.mesh.scale.y,
    };
  }

  /**
   * Internal world rect fallback with bundle.
   */
  private getLayerWorldRect(bundle: CaptureBundle, layerId: string): WorldRect | null {
    const layer = bundle.layers.find((l) => l.id === layerId);
    if (!layer) return null;

    if (layer.role === 'background') {
      const bg = bundle.layers.find((l) => l.role === 'background');
      const w = bg?.rect.w ?? bundle.viewport.width;
      const h = bg?.rect.h ?? bundle.viewport.height;
      return { cx: 0, cy: 0, w, h };
    }

    const built = this.layers.get(layerId);
    if (built) {
      return {
        cx: built.mesh.position.x,
        cy: built.mesh.position.y,
        w: built.width * built.mesh.scale.x,
        h: built.height * built.mesh.scale.y,
      };
    }

    const bg = bundle.layers.find((l) => l.role === 'background');
    const cx = (bg?.rect.w ?? bundle.viewport.width) / 2;
    const cy = (bg?.rect.h ?? bundle.viewport.height) / 2;
    return {
      // Page coordinates (y down) → world coordinates (y up), centred.
      cx: layer.rect.x + layer.rect.w / 2 - cx,
      cy: cy - (layer.rect.y + layer.rect.h / 2),
      w: Math.max(1, layer.rect.w),
      h: Math.max(1, layer.rect.h),
    };
  }

  /** Frames the captured source viewport, not the full scrollable page. */
  fitCamera(bundle: CaptureBundle, fov: number, padding = 0.08): CameraValues {
    const bg = bundle.layers.find((l) => l.role === 'background');
    const pageWidth = bg?.rect.w ?? bundle.viewport.width;
    const pageHeight = bg?.rect.h ?? bundle.viewport.height;
    const viewportWidth = bundle.viewport.width;
    const viewportHeight = bundle.viewport.height;
    const scrollX = bundle.viewport.scrollX ?? 0;
    const scrollY = bundle.viewport.scrollY ?? 0;

    const fit = fitRectInFrame(
      {
        cx: scrollX + viewportWidth / 2 - pageWidth / 2,
        cy: pageHeight / 2 - (scrollY + viewportHeight / 2),
        w: viewportWidth,
        h: viewportHeight,
      },
      this.frameAspect,
      fov,
      padding,
    );

    return {
      ...DEFAULT_CAMERA_VALUES,
      fov,
      distance: fit.distance,
      focus: fit.distance,
      orbitX: 0,
      orbitY: 0,
      roll: 0,
      targetX: fit.targetX,
      targetY: fit.targetY,
    };
  }

  /** Frames a single layer inside the composition frame. */
  fitLayer(
    bundle: CaptureBundle,
    layerId: string,
    fov: number,
    padding = 0.12,
  ): CameraValues | null {
    const rect = this.getLayerWorldRect(bundle, layerId);
    if (!rect) return null;
    const fit = fitRectInFrame(rect, this.frameAspect, fov, padding);
    return {
      ...DEFAULT_CAMERA_VALUES,
      fov,
      distance: fit.distance,
      focus: fit.distance,
      orbitX: 0,
      orbitY: 0,
      roll: 0,
      targetX: fit.targetX,
      targetY: fit.targetY,
    };
  }

  /** Frames the bounding box of every visible built layer. */
  fitAll(bundle: CaptureBundle, fov: number, padding = 0.08): CameraValues {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const obj of this.layers.values()) {
      if (!obj.mesh.visible || obj.layer.role === 'background') continue;
      const w = obj.width * obj.mesh.scale.x;
      const h = obj.height * obj.mesh.scale.y;
      minX = Math.min(minX, obj.mesh.position.x - w / 2);
      maxX = Math.max(maxX, obj.mesh.position.x + w / 2);
      minY = Math.min(minY, obj.mesh.position.y - h / 2);
      maxY = Math.max(maxY, obj.mesh.position.y + h / 2);
    }

    // Nothing built (or everything hidden): the source viewport is the only
    // meaningful fallback.
    if (!Number.isFinite(minX)) return this.fitCamera(bundle, fov, padding);

    const fit = fitRectInFrame(
      {
        cx: (minX + maxX) / 2,
        cy: (minY + maxY) / 2,
        w: Math.max(1, maxX - minX),
        h: Math.max(1, maxY - minY),
      },
      this.frameAspect,
      fov,
      padding,
    );

    return {
      ...DEFAULT_CAMERA_VALUES,
      fov,
      distance: fit.distance,
      focus: fit.distance,
      orbitX: 0,
      orbitY: 0,
      roll: 0,
      targetX: fit.targetX,
      targetY: fit.targetY,
    };
  }

  resize(width: number, height: number) {
    const pr = this.renderer.getPixelRatio();
    this.renderer.setSize(width, height, false);
    this.targetSize = { width, height };
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(width, height);
    this.fxaa?.setSize(width * pr, height * pr);
    this.camera.aspect = this.frameAspect;
    this.camera.updateProjectionMatrix();
  }

  /** Fixed-size render target used by the deterministic export loop. */
  setExportSize(width: number, height: number) {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.targetSize = { width, height };
    this.composer?.setPixelRatio(1);
    this.composer?.setSize(width, height);
    this.fxaa?.setSize(width, height);
    this.camera.aspect = this.frameAspect;
    this.camera.updateProjectionMatrix();
  }

  /** Single render dispatch shared by the preview loop and the export loop. */
  renderFrame() {
    if (this.contextLost) return;
    if (this.dofEnabled && this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  disposeLayers() {
    for (const obj of this.layers.values()) {
      this.scene.remove(obj.mesh);
      obj.mesh.geometry.dispose();
      obj.basicMaterial.dispose();
      obj.lambertMaterial.dispose();
      obj.texture?.dispose();
    }
    this.layers.clear();
  }

  dispose() {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.disposeLayers();
    this.directionalLight?.dispose();
    this.ambientLight?.dispose();
    this.fxaa?.dispose();
    this.composer?.dispose();
    this.dummy.dispose();
    this.renderer.dispose();
  }
}
