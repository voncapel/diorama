import * as THREE from 'three';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';

/** Keep each surface's mask in the depth image used by depth of field. */
export class LayerBokehPass extends BokehPass {
  override render(...args: Parameters<BokehPass['render']>) {
    const scene = this.scene;
    const before = scene.onBeforeRender;
    const after = scene.onAfterRender;
    const originalOverride = scene.overrideMaterial;
    const materials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    let depthOverride: THREE.Material | null = null;
    const restoreMaterials = () => {
      for (const [mesh, material] of materials) mesh.material = material;
      materials.clear();
    };
    scene.onBeforeRender = (...renderArgs) => {
      before.apply(scene, renderArgs);
      depthOverride = scene.overrideMaterial;
      if (!depthOverride) return;
      // Bokeh normally overrides every mesh with one opaque depth material.
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        materials.set(object, object.material);
        object.material = object.customDepthMaterial ?? depthOverride!;
      });
      scene.overrideMaterial = null;
    };
    scene.onAfterRender = (...renderArgs) => {
      restoreMaterials();
      scene.overrideMaterial = depthOverride;
      after.apply(scene, renderArgs);
    };
    try {
      super.render(...args);
    } finally {
      restoreMaterials();
      scene.overrideMaterial = originalOverride;
      scene.onBeforeRender = before;
      scene.onAfterRender = after;
    }
  }
}
