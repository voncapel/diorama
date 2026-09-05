import * as THREE from 'three';

/** A local-space mask shared by every material rendering a layer's surface.
 * 0° opens left to right; 90° opens top to bottom. Feather stays inside the edge.
 * The content's geometry and UVs never change when the mask opens.
 */
export class LayerReveal {
  readonly uniforms = {
    dioReveal: { value: 1 },
    dioRevealDirection: { value: new THREE.Vector2(1, 0) },
    dioRevealSize: { value: new THREE.Vector2() },
    dioRevealFeather: { value: 0 },
  };

  constructor(width: number, height: number) {
    this.uniforms.dioRevealSize.value.set(width, height);
  }

  update(progress: number, angle: number, feather: number) {
    this.uniforms.dioReveal.value = THREE.MathUtils.clamp(progress / 100, 0, 1);
    const radians = angle * Math.PI / 180;
    this.uniforms.dioRevealDirection.value.set(Math.cos(radians), Math.sin(radians));
    this.uniforms.dioRevealFeather.value = Math.max(0, feather);
  }

  /** Mirrors the shader so invisible portions do not intercept picking/focus. */
  alphaAt(u: number, v: number): number {
    const progress = this.uniforms.dioReveal.value;
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    const direction = this.uniforms.dioRevealDirection.value;
    const size = this.uniforms.dioRevealSize.value;
    const span = Math.abs(direction.x) * size.x + Math.abs(direction.y) * size.y;
    const distance = (u - 0.5) * size.x * direction.x + (0.5 - v) * size.y * direction.y + span / 2;
    // Move the feather entirely past the surface at the end; no pop at 100%.
    const edge = progress * (span + this.uniforms.dioRevealFeather.value);
    const inside = edge - distance;
    const feather = this.uniforms.dioRevealFeather.value;
    if (feather <= 0) return inside >= 0 ? 1 : 0;
    const t = THREE.MathUtils.clamp(inside / feather, 0, 1);
    return t * t * (3 - 2 * t);
  }

  attach(material: THREE.Material, shadow = false) {
    material.customProgramCacheKey = () => `diorama-reveal-v1:${shadow}`;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = `varying vec2 dioMaskUv;\n${shader.vertexShader}`
        .replace('#include <uv_vertex>', '#include <uv_vertex>\ndioMaskUv = uv;');
      shader.fragmentShader = `
        varying vec2 dioMaskUv;
        uniform float dioReveal;
        uniform vec2 dioRevealDirection;
        uniform vec2 dioRevealSize;
        uniform float dioRevealFeather;
        float dioMaskAlpha() {
          if (dioReveal <= 0.0) return 0.0;
          if (dioReveal >= 1.0) return 1.0;
          float span = dot(abs(dioRevealDirection), dioRevealSize);
          vec2 point = vec2(dioMaskUv.x - 0.5, 0.5 - dioMaskUv.y) * dioRevealSize;
          float distance = dot(point, dioRevealDirection) + span * 0.5;
          float inside = dioReveal * (span + dioRevealFeather) - distance;
          if (dioRevealFeather <= 0.0) return step(0.0, inside);
          return smoothstep(0.0, dioRevealFeather, inside);
        }
        ${shader.fragmentShader}`.replace('#include <alphatest_fragment>', `
          float dioAlpha = dioMaskAlpha();
          if (dioAlpha <= 0.0) discard;
          ${shadow ? `
          // Depth maps cannot store translucent coverage: dither the soft edge.
          float threshold = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (dioAlpha < threshold) discard;
          ` : 'diffuseColor.a *= dioAlpha;'}
          #include <alphatest_fragment>
        `);
    };
  }
}
