import * as THREE from 'three';
import { LayerReveal } from './layerReveal';

/** Static UV mapping for the 5 faces (dos + 4 chants), 10 triangles, 30 vertices. */
const EXTRUSION_UVS = new Float32Array([
  // Triangle 1: Dos (TL_b, TR_b, BL_b)
  0, 1,
  1, 1,
  0, 0,
  // Triangle 2: Dos (TR_b, BR_b, BL_b)
  1, 1,
  1, 0,
  0, 0,

  // Triangle 3: Top chant (TL_f, TR_f, TR_b)
  0, 1,
  1, 1,
  1, 1,
  // Triangle 4: Top chant (TL_f, TR_b, TL_b)
  0, 1,
  1, 1,
  0, 1,

  // Triangle 5: Bottom chant (BL_f, BL_b, BR_b)
  0, 0,
  0, 0,
  1, 0,
  // Triangle 6: Bottom chant (BL_f, BR_b, BR_f)
  0, 0,
  1, 0,
  1, 0,

  // Triangle 7: Left chant (TL_f, TL_b, BL_b)
  0, 1,
  0, 1,
  0, 0,
  // Triangle 8: Left chant (TL_f, BL_b, BL_f)
  0, 1,
  0, 0,
  0, 0,

  // Triangle 9: Right chant (TR_f, BR_b, TR_b)
  1, 1,
  1, 0,
  1, 1,
  // Triangle 10: Right chant (TR_f, BR_f, BR_b)
  1, 1,
  1, 0,
  1, 0,
]);

/**
 * Three.js mesh representing a thin rectangular plate extrusion behind a layer plane.
 * Extrudes from the local front plane (z=0) backward to z = -thickness.
 * Includes the back face ("dos") and 4 edge rims ("chants"), omitting the front face.
 */
export class LayerExtrusion {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>;

  private readonly geometry: THREE.BufferGeometry;
  private readonly basicMaterial: THREE.MeshBasicMaterial;
  private readonly lambertMaterial: THREE.MeshLambertMaterial;
  private readonly depthMaterial: THREE.MeshDepthMaterial;
  private readonly cutout: number;

  private readonly posArray = new Float32Array(90);
  private readonly normArray = new Float32Array(90);
  private readonly posAttr: THREE.BufferAttribute;
  private readonly normAttr: THREE.BufferAttribute;

  constructor(texture: THREE.Texture | null, reveal: LayerReveal, cutout: number) {
    this.cutout = cutout;

    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.posArray, 3);
    this.normAttr = new THREE.BufferAttribute(this.normArray, 3);
    this.geometry.setAttribute('position', this.posAttr);
    this.geometry.setAttribute('normal', this.normAttr);
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(EXTRUSION_UVS, 2));

    // Pre-calculate initial bounding structures once to avoid runtime allocations
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();

    this.basicMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      color: 0xffffff,
      transparent: true,
      depthWrite: true,
      alphaTest: cutout,
      toneMapped: false,
      shadowSide: THREE.DoubleSide,
    });

    this.lambertMaterial = new THREE.MeshLambertMaterial({
      map: texture,
      color: 0xffffff,
      emissive: 0x000000,
      transparent: true,
      depthWrite: true,
      alphaTest: cutout,
      toneMapped: false,
      shadowSide: THREE.DoubleSide,
    });

    this.depthMaterial = new THREE.MeshDepthMaterial({
      depthPacking: THREE.RGBADepthPacking,
      map: texture ?? null,
      alphaTest: cutout,
      shadowSide: THREE.DoubleSide,
    });

    reveal.attach(this.basicMaterial);
    reveal.attach(this.lambertMaterial);
    reveal.attach(this.depthMaterial, true);

    this.mesh = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>(
      this.geometry,
      this.basicMaterial,
    );
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.visible = false;
  }

  update(
    frontPositions: ArrayLike<number>,
    thickness: number,
    opacity: number,
    lit: boolean,
    castShadow: boolean,
  ): void {
    thickness = Number.isFinite(thickness) ? Math.max(0, thickness) : 0;
    const targetMat = lit ? this.lambertMaterial : this.basicMaterial;
    if (this.mesh.material !== targetMat) {
      this.mesh.material = targetMat;
    }

    const alphaTest = this.cutout * opacity;
    this.basicMaterial.opacity = opacity;
    this.lambertMaterial.opacity = opacity;
    this.basicMaterial.alphaTest = alphaTest;
    this.lambertMaterial.alphaTest = alphaTest;
    this.depthMaterial.alphaTest = alphaTest;

    this.mesh.castShadow = castShadow;

    if (thickness <= 0 || opacity <= 0 || frontPositions.length < 12) {
      this.mesh.visible = false;
      return;
    }

    this.mesh.visible = true;

    // Front corners in PlaneGeometry order: TL (0), TR (1), BL (2), BR (3)
    const tlX = frontPositions[0] ?? 0;
    const tlY = frontPositions[1] ?? 0;
    const tlZ = frontPositions[2] ?? 0;

    const trX = frontPositions[3] ?? 0;
    const trY = frontPositions[4] ?? 0;
    const trZ = frontPositions[5] ?? 0;

    const blX = frontPositions[6] ?? 0;
    const blY = frontPositions[7] ?? 0;
    const blZ = frontPositions[8] ?? 0;

    const brX = frontPositions[9] ?? 0;
    const brY = frontPositions[10] ?? 0;
    const brZ = frontPositions[11] ?? 0;

    // Back corners extruded towards -Z
    const tlZb = tlZ - thickness;
    const trZb = trZ - thickness;
    const blZb = blZ - thickness;
    const brZb = brZ - thickness;

    const pos = this.posArray;

    // Triangle 1: Dos (TL_b, TR_b, BL_b)
    pos[0] = tlX; pos[1] = tlY; pos[2] = tlZb;
    pos[3] = trX; pos[4] = trY; pos[5] = trZb;
    pos[6] = blX; pos[7] = blY; pos[8] = blZb;

    // Triangle 2: Dos (TR_b, BR_b, BL_b)
    pos[9] = trX;   pos[10] = trY; pos[11] = trZb;
    pos[12] = brX;  pos[13] = brY; pos[14] = brZb;
    pos[15] = blX;  pos[16] = blY; pos[17] = blZb;

    // Triangle 3: Top chant (TL_f, TR_f, TR_b)
    pos[18] = tlX;  pos[19] = tlY; pos[20] = tlZ;
    pos[21] = trX;  pos[22] = trY; pos[23] = trZ;
    pos[24] = trX;  pos[25] = trY; pos[26] = trZb;

    // Triangle 4: Top chant (TL_f, TR_b, TL_b)
    pos[27] = tlX;  pos[28] = tlY; pos[29] = tlZ;
    pos[30] = trX;  pos[31] = trY; pos[32] = trZb;
    pos[33] = tlX;  pos[34] = tlY; pos[35] = tlZb;

    // Triangle 5: Bottom chant (BL_f, BL_b, BR_b)
    pos[36] = blX;  pos[37] = blY; pos[38] = blZ;
    pos[39] = blX;  pos[40] = blY; pos[41] = blZb;
    pos[42] = brX;  pos[43] = brY; pos[44] = brZb;

    // Triangle 6: Bottom chant (BL_f, BR_b, BR_f)
    pos[45] = blX;  pos[46] = blY; pos[47] = blZ;
    pos[48] = brX;  pos[49] = brY; pos[50] = brZb;
    pos[51] = brX;  pos[52] = brY; pos[53] = brZ;

    // Triangle 7: Left chant (TL_f, TL_b, BL_b)
    pos[54] = tlX;  pos[55] = tlY; pos[56] = tlZ;
    pos[57] = tlX;  pos[58] = tlY; pos[59] = tlZb;
    pos[60] = blX;  pos[61] = blY; pos[62] = blZb;

    // Triangle 8: Left chant (TL_f, BL_b, BL_f)
    pos[63] = tlX;  pos[64] = tlY; pos[65] = tlZ;
    pos[66] = blX;  pos[67] = blY; pos[68] = blZb;
    pos[69] = blX;  pos[70] = blY; pos[71] = blZ;

    // Triangle 9: Right chant (TR_f, BR_b, TR_b)
    pos[72] = trX;  pos[73] = trY; pos[74] = trZ;
    pos[75] = brX;  pos[76] = brY; pos[77] = brZb;
    pos[78] = trX;  pos[79] = trY; pos[80] = trZb;

    // Triangle 10: Right chant (TR_f, BR_f, BR_b)
    pos[81] = trX;  pos[82] = trY; pos[83] = trZ;
    pos[84] = brX;  pos[85] = brY; pos[86] = brZ;
    pos[87] = brX;  pos[88] = brY; pos[89] = brZb;

    // In-place face normal calculation for all 10 triangles (zero runtime allocations)
    const norm = this.normArray;
    for (let t = 0; t < 10; t++) {
      const i0 = t * 9;
      const i1 = i0 + 3;
      const i2 = i0 + 6;

      const abX = (pos[i1] ?? 0) - (pos[i0] ?? 0);
      const abY = (pos[i1 + 1] ?? 0) - (pos[i0 + 1] ?? 0);
      const abZ = (pos[i1 + 2] ?? 0) - (pos[i0 + 2] ?? 0);

      const acX = (pos[i2] ?? 0) - (pos[i0] ?? 0);
      const acY = (pos[i2 + 1] ?? 0) - (pos[i0 + 1] ?? 0);
      const acZ = (pos[i2 + 2] ?? 0) - (pos[i0 + 2] ?? 0);

      let nx = abY * acZ - abZ * acY;
      let ny = abZ * acX - abX * acZ;
      let nz = abX * acY - abY * acX;

      const len = Math.hypot(nx, ny, nz);
      if (len > 1e-6) {
        const inv = 1 / len;
        nx *= inv;
        ny *= inv;
        nz *= inv;
      } else {
        nx = 0;
        ny = 0;
        nz = -1;
      }

      norm[i0] = nx; norm[i0 + 1] = ny; norm[i0 + 2] = nz;
      norm[i1] = nx; norm[i1 + 1] = ny; norm[i1 + 2] = nz;
      norm[i2] = nx; norm[i2 + 1] = ny; norm[i2 + 2] = nz;
    }

    this.posAttr.needsUpdate = true;
    this.normAttr.needsUpdate = true;
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }

  setLighting(lit: boolean, castShadow: boolean): void {
    this.mesh.material = lit ? this.lambertMaterial : this.basicMaterial;
    this.mesh.castShadow = castShadow;
  }

  dispose(): void {
    this.geometry.dispose();
    this.basicMaterial.dispose();
    this.lambertMaterial.dispose();
    this.depthMaterial.dispose();
  }
}
