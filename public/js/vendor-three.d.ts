// vendor-three.d.ts — permissive stand-in for the vendored Three.js build.
//
// The browser loads `/vendor/three.module.js` from the site root; tsc cannot
// follow that URL (and an ambient `declare module` does not match root-relative
// specifiers), so tsconfig `paths` maps the import here. Members are typed any:
// the renderers' own logic stays checked, the library internals do not.
// Add a line here if a new THREE.* identifier shows up in map3d.js / models3d.js.

export const AmbientLight: any;
export const BoxGeometry: any;
export const CanvasTexture: any;
export const Color: any;
export const ConeGeometry: any;
export const CylinderGeometry: any;
export const DodecahedronGeometry: any;
export const DoubleSide: any;
export const FogExp2: any;
export const Group: any;
export const HemisphereLight: any;
export const Mesh: any;
export const MeshBasicMaterial: any;
export const MeshLambertMaterial: any;
export const OctahedronGeometry: any;
export const PerspectiveCamera: any;
export const PointLight: any;
export const Raycaster: any;
export const RepeatWrapping: any;
export const RingGeometry: any;
export const Scene: any;
export const SphereGeometry: any;
export const Sprite: any;
export const SpriteMaterial: any;
export const TorusGeometry: any;
export const Vector2: any;
export const Vector3: any;
export const WebGLRenderer: any;
