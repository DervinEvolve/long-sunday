// A bare page that shows the packed real look and nothing else: three.js, the glTF chunks, their
// lightmaps, the shared textures and the sky. No code from the ink engine. It is here to prove
// the files in public/real/ work with standard materials, and to read the manifest the way the
// browser side will.
//
//   /tools/real/viewer.html?view=trailhead            the follow camera at that arrival point
//   ...?cam=x,y,z,tx,ty,tz&fov=46                     a fixed camera
//   ...?chunks=trailhead,ground                       only these (default: all)
//   ...?half=1                                        the half size lightmaps and textures
//   ...?show=light | class | flat                     lightmap only, material classes, no textures
//   ...?reflect=0.5                                   scale every material's reflection of the sky
//   ...?info=1                                        draw calls and triangles on screen
//   ...?lut=0                                         three's own AgX instead of Blender's table
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const params = new URLSearchParams(location.search);
const BASE = '/real/';
const half = params.get('half') === '1';
const show = params.get('show') ?? '';
const canvas = document.getElementById('c');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 6000);

const manifest = await (await fetch(BASE + 'manifest.json')).json();
renderer.toneMapping = manifest.look.toneMapping === 'AgX' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = Number(params.get('exposure') ?? manifest.look.exposure);

// Blender's AgX, from the table in the manifest, in a pass of its own after the scene. three's own
// AgX is a fitted curve that lifts shade by a fifth to a third against the one the bake was made for.
let post = null;
if (manifest.look.lut && params.get('lut') !== '0') {
  const L = manifest.look.lut;
  const lut = await new THREE.TextureLoader().loadAsync(BASE + L.file);
  lut.flipY = false;
  lut.colorSpace = THREE.NoColorSpace;
  lut.generateMipmaps = false;
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.needsUpdate = true;
  const target = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  const material = new THREE.ShaderMaterial({
    uniforms: { src: { value: target.texture }, lut: { value: lut }, exposure: { value: renderer.toneMappingExposure } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D src; uniform sampler2D lut; uniform float exposure; varying vec2 vUv;
      const float N = ${L.size.toFixed(1)}; const float LO = ${L.logMin}; const float HI = ${L.logMax};
      void main() {
        vec3 c = texture2D(src, vUv).rgb * exposure;
        vec3 u = clamp((log2(max(c, vec3(1e-10))) - LO) / (HI - LO), 0.0, 1.0) * (N - 1.0);
        float b0 = floor(u.b);
        float b1 = min(b0 + 1.0, N - 1.0);
        vec2 a = vec2((u.r + 0.5 + b0 * N) / (N * N), (u.g + 0.5) / N);
        vec2 b = vec2((u.r + 0.5 + b1 * N) / (N * N), (u.g + 0.5) / N);
        gl_FragColor = vec4(mix(texture2D(lut, a).rgb, texture2D(lut, b).rgb, u.b - b0), 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const postScene = new THREE.Scene();
  postScene.add(quad);
  renderer.toneMapping = THREE.NoToneMapping;
  post = { target, scene: postScene, camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1) };
}

const loader = new THREE.TextureLoader();
const textureCache = new Map();
const pending = new Set();
/** Every image in public/real follows glTF: uv (0, 0) is the top left texel. So flipY is off. */
function texture(file, { srgb = false, repeat = true, nearest = false } = {}) {
  const key = file + (srgb ? ':s' : ':l');
  let t = textureCache.get(key);
  if (!t) {
    t = loader.load(BASE + file, () => pending.delete(key), undefined, () => pending.delete(key));
    pending.add(key);
    t.flipY = false;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (nearest) {
      t.minFilter = t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
    } else t.anisotropy = 8;
    textureCache.set(key, t);
  }
  return t;
}
const pick = (entry) => (half && entry.half ? entry.half : entry.file);

// The lightmap already holds the sky's light on every surface. So the environment map is for
// reflections only: its diffuse part is cut out of the standard material here.
const cut = THREE.ShaderChunk.lights_fragment_maps.replace('iblIrradiance += getIBLIrradiance( geometryNormal );', '');
function reflectionsOnly(material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_maps>', cut);
  };
  return material;
}

// ---- sky --------------------------------------------------------------------------------------
let sky = null;
if (manifest.environment) {
  const hdr = await new HDRLoader().loadAsync(BASE + manifest.environment.file);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  scene.background = hdr;
  if (show === '' || show === 'flat') sky = hdr;
} else scene.background = new THREE.Color(0x9fb4d8);

const CLASS_COLORS = {};
function classColor(name) {
  if (!CLASS_COLORS[name]) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
    CLASS_COLORS[name] = new THREE.Color().setHSL(h / 360, 0.6, 0.55);
  }
  return CLASS_COLORS[name];
}

function makeMaterial(name, lightMap) {
  const m = manifest.materials[name];
  const common = { vertexColors: true, side: THREE.DoubleSide, lightMap, lightMapIntensity: manifest.look.lightMapIntensity };
  if (show === 'class') return new THREE.MeshBasicMaterial({ color: classColor(name), side: THREE.DoubleSide });
  if (show === 'light') return new THREE.MeshBasicMaterial({ color: 0xb4b4b4, side: THREE.DoubleSide, lightMap, lightMapIntensity: manifest.look.lightMapIntensity * Math.PI });
  let mat;
  if (m.kind === 'plain') {
    mat = new THREE.MeshStandardMaterial({ ...common, roughness: 1, metalness: 1 });
    if (m.swatch) mat.roughnessMap = mat.metalnessMap = texture(m.swatch, { repeat: false, nearest: true });
  } else if (m.kind === 'glass') {
    mat = new THREE.MeshStandardMaterial({ ...common, roughness: m.roughness, metalness: m.metalness, transparent: true, opacity: m.opacity, depthWrite: false });
  } else if (m.kind === 'lettering') {
    mat = new THREE.MeshStandardMaterial({
      ...common, roughness: 0.8, metalness: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      alphaMap: texture(half ? manifest.lettering.half : manifest.lettering.file, { repeat: false }),
    });
  } else {
    mat = new THREE.MeshStandardMaterial({ ...common, roughness: m.roughness ?? 1, metalness: m.metalness ?? 0 });
    const set = m.texture && show !== 'flat' ? manifest.textures[m.texture] : null;
    if (set?.color) mat.map = texture(pick(set.color), { srgb: true });
    if (set?.normal) {
      mat.normalMap = texture(pick(set.normal));
      // uv runs top down here, as in every glTF: the normal map's green channel flips with it.
      mat.normalScale.set(m.normalScale ?? 1, -(m.normalScale ?? 1));
    }
    if (set?.orm) {
      mat.roughnessMap = mat.metalnessMap = texture(pick(set.orm));
      mat.roughness = 1;
      mat.metalness = 1;
    } else if (m.texture && !set) mat.color.setScalar(0.5);
    if (m.kind === 'cards') mat.alphaTest = m.alphaTest;
  }
  mat.name = name;
  // The sky goes on the material itself. three ignores envMapIntensity for scene.environment.
  mat.envMap = sky;
  mat.envMapIntensity = (m.reflect ?? 1) * Number(params.get('reflect') ?? 1);
  return reflectionsOnly(mat);
}

// ---- chunks -----------------------------------------------------------------------------------
const want = params.get('chunks')?.split(',');
const gltf = new GLTFLoader();
gltf.setMeshoptDecoder(MeshoptDecoder);
const loaded = [];
/** A chunk file is a gzipped glb. If something on the way already opened it, take it as it is. */
async function chunkBytes(file) {
  const bytes = await (await fetch(BASE + file)).arrayBuffer();
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
await Promise.all(
  manifest.chunks
    .filter((c) => !want || want.includes(c.id))
    .map(async (c) => {
      const lightMaps = c.lightmaps.map((l) => {
        const t = texture(half ? l.half : l.file, { srgb: true, repeat: false });
        t.channel = 1;
        return t;
      });
      const g = await gltf.parseAsync(await chunkBytes(c.file), '');
      g.scene.traverse((o) => {
        if (!o.isMesh) return;
        const page = o.userData.page ?? 0;
        o.material = makeMaterial(o.userData.material ?? o.material.name, lightMaps[page]);
        if (o.material.transparent) o.renderOrder = o.material.name === 'lettering' ? 2 : 1;
      });
      scene.add(g.scene);
      loaded.push(c.id);
    }),
);

// ---- camera -----------------------------------------------------------------------------------
const cam = params.get('cam')?.split(',').map(Number);
const view = params.get('view') ?? 'trailhead';
let controls = null;
if (cam && cam.length >= 6) {
  camera.fov = Number(params.get('fov') ?? 46);
  camera.position.set(cam[0], cam[1], cam[2]);
  camera.lookAt(cam[3], cam[4], cam[5]);
} else {
  const p = manifest.cameras[view];
  camera.fov = p.fov;
  camera.position.fromArray(p.position);
  camera.quaternion.fromArray(p.quaternion);
}
camera.updateProjectionMatrix();
if (params.get('orbit') === '1') {
  controls = new OrbitControls(camera, canvas);
  controls.target.copy(camera.position).add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(20));
}

const note = document.getElementById('note');
const live = params.get('orbit') === '1' || params.get('info') === '1';
function draw() {
  if (controls) controls.update();
  if (post) {
    renderer.setRenderTarget(post.target);
    renderer.render(scene, camera);
    const calls = renderer.info.render.calls;
    const triangles = renderer.info.render.triangles;
    renderer.setRenderTarget(null);
    renderer.render(post.scene, post.camera);
    renderer.info.render.calls = calls;
    renderer.info.render.triangles = triangles;
  } else renderer.render(scene, camera);
  if (params.get('info') === '1') {
    note.hidden = false;
    note.textContent = `calls ${renderer.info.render.calls}   tris ${renderer.info.render.triangles}\n${loaded.join(' ')}`;
  }
}
// A still camera needs one picture, not sixty a second: only orbit mode keeps drawing.
function frame() {
  draw();
  if (live) requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  if (post) post.target.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  if (!live) draw();
});
if (params.get('dbg') === '1') Object.assign(window, { __scene: scene, __draw: draw, __three: THREE });
// For pictures from many cameras in one load: [x, y, z, tx, ty, tz] and a fov, or a view name.
window.__look = (to, fov) => {
  if (typeof to === 'string') {
    const p = manifest.cameras[to];
    camera.fov = p.fov;
    camera.position.fromArray(p.position);
    camera.quaternion.fromArray(p.quaternion);
  } else {
    camera.fov = fov ?? 46;
    camera.position.set(to[0], to[1], to[2]);
    camera.lookAt(to[3], to[4], to[5]);
  }
  camera.updateProjectionMatrix();
  draw();
  return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
};
frame();
// Textures arrive after the first frame: draw again and say ready once everything asked for has come in.
const settle = () => {
  if (pending.size > 0) return void setTimeout(settle, 50);
  requestAnimationFrame(() => {
    draw();
    requestAnimationFrame(() => {
      draw();
      window.__viewer = { ready: true, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, chunks: loaded };
    });
  });
};
settle();
