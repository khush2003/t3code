import * as THREE from "three";

import { createCreature, type CreatureLook } from "./clay";

const SIZE = 192;
const cache = new Map<string, string>();
let renderer: THREE.WebGLRenderer | null = null;

/**
 * Renders creatures to still images with one shared offscreen renderer; nothing animates.
 * Results are cached per form and look, so pickers and headers cost one render each.
 */
export function renderPortraits(
  requests: ReadonlyArray<{ readonly formIndex: number; readonly look: CreatureLook }>,
): Array<string> {
  return requests.map(({ formIndex, look }) => {
    const key = `${formIndex}:${look.accent}:${look.role}:${look.stage}`;
    const cached = cache.get(key);
    if (cached) return cached;
    renderer ??= new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(2);
    renderer.setSize(SIZE, SIZE, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight("#f3efe2", "#6f7d68", 2.2));
    const key1 = new THREE.DirectionalLight("#ffe2b2", 2.6);
    key1.position.set(-2, 4, 5);
    const rim = new THREE.DirectionalLight("#88c3d5", 1.6);
    rim.position.set(3, 2, -4);
    scene.add(key1, rim);
    const rig = createCreature(formIndex, look);
    rig.root.rotation.y = 0.35;
    scene.add(rig.root);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50);
    camera.position.set(0.9, 1.75, 5.2);
    camera.lookAt(0, 1.2, 0);
    renderer.setClearColor(0x000000, 0);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL("image/png");
    rig.root.traverse((node) => {
      if (node instanceof THREE.Mesh) node.geometry.dispose();
    });
    cache.set(key, url);
    return url;
  });
}
