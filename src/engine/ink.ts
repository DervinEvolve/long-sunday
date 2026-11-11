// The ink renderer. Two passes, one material.
//
// Pass one draws the scene into two colour buffers and a depth texture:
//   buffer 0   lit colour, with hatch line coverage in alpha
//   buffer 1   view-space normal, with the outline id in alpha (0 is sky, 255 means "no line here")
// Pass two is one full screen triangle. It finds edges where depth, normal or id jump, draws the ink
// line at a constant width in CSS pixels, lays the violet hatching over the shade, paints the sky
// where nothing was drawn, fades distance into haze and finishes with paper grain.
//
// Colour is handled by hand. Everything authored is sRGB and is written to the screen untouched,
// so a palette hex comes out as that hex wherever the light is full.
import * as THREE from 'three';
import type { ColorLike, InkKit, QualityTier } from '../types';
import { palette } from '../world/palette';
import { createKit, toHex } from './kit';
import { createLettering } from './lettering';

export interface SkyColors {
  top: ColorLike;
  mid: ColorLike;
  horizon: ColorLike;
  haze: ColorLike;
}

export interface Ink {
  renderer: THREE.WebGLRenderer;
  kit: InkKit;
  /** Called every frame with already-blended colours. Pass numbers (0xRRGGBB) to stay allocation free. */
  setSky(c: SkyColors): void;
  /** World-space direction toward the sun. */
  setSun(dir: THREE.Vector3): void;
  setFog(near: number, far: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  /** Low drops cross hatching, the soft line fringe and the grain. Never the outline. */
  setQuality(tier: QualityTier): void;
  /** Freeze sway, wobble and grain so two screenshots of the same view match. */
  setStill(still: boolean): void;
  /** Reduced motion: plants stop swaying and the paper grain stops boiling. The line itself is unchanged. */
  setCalm(calm: boolean): void;
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, timeSeconds: number): void;
  /** Draw calls and triangles of the last frame, the full screen pass included. The same object every call. */
  stats(): { calls: number; triangles: number };
  dispose(): void;
}

// ---------------------------------------------------------------------------------------------
// Tuning. These numbers are the look. Change them here, look at dev/kit.html, change them again.
// ---------------------------------------------------------------------------------------------

export const LOOK = {
  /** Ink line width in CSS pixels. */
  line: 1.5,
  /** How far the line strays from true, CSS pixels. */
  wobble: 0.65,
  /** n.l where full light gives way to half light, and half light to shade. */
  bands: [0.3, -0.06] as [number, number],
  /** Softness of the band edges. 0 is a hard cut. */
  bandSoft: 0.012,
  /** How far half light moves toward the shade colour. */
  midDepth: 0.42,
  /** Gap between hatch lines, CSS pixels (it breathes between this and half of it). */
  hatchGap: 9,
  /** How strongly the hatch colour is laid down. */
  hatchInk: 0.62,
  /** Most a far thing can dissolve into haze. */
  fogMax: 0.9,
  /** How much of its strength a far outline keeps. */
  farLine: 0.34,
  /** Paper grain strength. */
  grain: 0.035,
};

// ---------------------------------------------------------------------------------------------
// The shared material
// ---------------------------------------------------------------------------------------------

const INK_VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aData;
attribute vec4 aInk;

uniform float uTime;
uniform float uSway;

varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vHatchP;
varying vec2 vUv;
varying vec4 vParams;   // flat, extra hatch, dither coverage, lettering mode
varying vec3 vInk;
flat varying float vId;

vec3 toSrgb(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  mat4 m = modelMatrix;
  float id = aData.x * 255.0;
  vColor = aColor.rgb;
#ifdef USE_INSTANCING
  m = modelMatrix * instanceMatrix;
  // Every instance gets its own outline. 255 stays 255: that one means no line.
  if (id < 254.5) id = mod(id - 1.0 + float(gl_InstanceID) * 37.0, 251.0) + 1.0;
#endif
#ifdef USE_INSTANCING_COLOR
  // Instance colours arrive as three.js Colors, which are linear. Bring them back to what was authored.
  vColor *= toSrgb(instanceColor);
#endif
  mat3 m3 = mat3(m);
  vec3 sc = vec3(dot(m3[0], m3[0]), dot(m3[1], m3[1]), dot(m3[2], m3[2]));
  vNormalW = normalize(m3 * (normal / sc));
  vec4 wp = m * vec4(position, 1.0);
  // Hatching rides on the object: rotated and scaled with it, but not moved, so it never slides
  // across something that walks.
  vHatchP = m3 * position;

  float sw = aData.w;
  if (sw > 0.0) {
    float ph = m[3].x * 0.37 + m[3].z * 0.23 + position.x * 0.31 + position.z * 0.27;
    float a = sin(uTime * 1.35 + ph) + 0.45 * sin(uTime * 2.9 + ph * 1.7);
    float b = cos(uTime * 1.1 + ph * 1.3);
    wp.xz += sw * uSway * vec2(a, b * 0.6);
  }

  vUv = uv;
  vParams = vec4(aColor.a, aData.y, aData.z, aInk.a);
  vInk = aInk.rgb;
  vId = id / 255.0;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const INK_FRAG = /* glsl */ `
layout(location = 1) out highp vec4 gNormalId;

uniform sampler2D uAtlas;
uniform float uAtlasSize;
uniform vec3 uSun;
uniform vec3 uShadow;
uniform vec3 uSkyFill;
uniform vec2 uBands;
uniform float uBandSoft;
uniform float uMidDepth;
uniform float uPx;
uniform float uHatchGap;
uniform float uCross;

varying vec3 vColor;
varying vec3 vNormalW;
varying vec3 vHatchP;
varying vec2 vUv;
varying vec4 vParams;
varying vec3 vInk;
flat varying float vId;

float bayer4(vec2 p) {
  ivec2 i = ivec2(p) & 3;
  const float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[i.x + i.y * 4] + 0.5) / 16.0;
}

// Parallel lines stuck to the surface, kept at an even gap on screen. The gap in world units is
// picked from how fast the coordinate changes per pixel, in powers of two; in between, every other
// line fades, so walking toward a wall draws new strokes between the old ones.
float hatchLines(float h, float halfWidth) {
  float g = max(length(vec2(dFdx(h), dFdy(h))), 1e-7);
  float lod = log2(g * uHatchGap * uPx);
  float fl = floor(lod);
  float f = lod - fl;
  float s = exp2(fl);
  float q = h / s;
  float d0 = abs(fract(q + 0.5) - 0.5) * s / g;
  float d1 = abs(fract(q * 0.5 + 0.5) - 0.5) * 2.0 * s / g;
  float aa = 0.7;
  float l0 = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, d0);
  float l1 = 1.0 - smoothstep(halfWidth - aa, halfWidth + aa, d1);
  return mix(l0, l1, f);
}

void main() {
  float flatness = vParams.x;
  float mode = vParams.w;
  float idOut = vId;

  // Screen door. A dithered surface also gives up its outline, or the holes would all be inked.
  if (vParams.z < 0.995) {
    if (bayer4(gl_FragCoord.xy) >= vParams.z) discard;
    idOut = 1.0;
  }

  // Lettering. Sampled for every fragment so the derivatives are defined; plain geometry reads texel 0.
  float a = texture2D(uAtlas, vUv).r;
  float cov = 0.0;
  if (mode > 0.25) {
    float sharp = clamp((a - 0.5) / clamp(fwidth(a), 0.02, 1.0) + 0.5, 0.0, 1.0);
    float texelsPerPixel = length(fwidth(vUv)) * uAtlasSize * 0.7071;
    // Close up: a hard edge. Far away: the mipmapped coverage, pushed up so thin strokes survive.
    cov = mix(sharp, clamp(a * 1.9, 0.0, 1.0), smoothstep(0.75, 1.8, texelsPerPixel));
    if (mode > 0.75) {
      if (cov < 0.5) discard;
      cov = 1.0;
      idOut = 1.0;
    } else if (cov < 0.02) discard;
  }

  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  float ndl = dot(n, uSun);

  // Two cuts make three bands: light, half light, shade.
  float b1 = smoothstep(uBands.x - uBandSoft, uBands.x + uBandSoft, ndl);
  float b2 = smoothstep(uBands.y - uBandSoft, uBands.y + uBandSoft, ndl);
  float light = mix(0.5 * (b1 + b2), 1.0, flatness);

  vec3 base = vColor;
  // Shade goes toward violet, never toward black.
  vec3 shade = mix(base * mix(vec3(1.0), uShadow, 0.5), uShadow, 0.14);
  // A little sky comes down onto anything that faces up.
  shade = mix(shade, uSkyFill, 0.1 * (n.y * 0.5 + 0.5));
  vec3 mid = mix(base, shade, uMidDepth);
  vec3 col = light > 0.5 ? mix(mid, base, light * 2.0 - 1.0) : mix(shade, mid, light * 2.0);

  // Hatching: in the shade band, heavier the further the surface turns from the sun, plus whatever the part asked for.
  float inShade = clamp(1.0 - light * 2.0, 0.0, 1.0);
  float amt = inShade * mix(0.55, 1.0, smoothstep(-0.1, -0.85, ndl)) + vParams.y;
  float hatch = 0.0;
  if (amt > 0.01) {
    float hw = uPx * mix(0.28, 0.72, clamp(amt, 0.0, 1.0));
    float h1 = dot(vHatchP, vec3(0.62, 0.70, 0.36));
    hatch = hatchLines(h1, hw) * smoothstep(0.0, 0.25, amt);
    float cross = smoothstep(0.95, 1.35, amt) * uCross;
    if (cross > 0.0) {
      float h2 = dot(vHatchP, vec3(-0.66, 0.58, 0.48));
      hatch = max(hatch, hatchLines(h2, hw * 0.85) * cross);
    }
  }

  col = mix(col, vInk, cov);
  hatch *= 1.0 - cov;

  vec3 vn = normalize(mat3(viewMatrix) * n);
  gl_FragColor = vec4(col, hatch);
  gNormalId = vec4(vn * 0.5 + 0.5, idOut);
}
`;

function vec3From(c: ColorLike): THREE.Vector3 {
  const h = toHex(c);
  return new THREE.Vector3((h >> 16) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
}

function createInkMaterial(atlas: THREE.Texture, atlasSize: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    name: 'ink',
    vertexShader: INK_VERT,
    fragmentShader: INK_FRAG,
    side: THREE.DoubleSide,
    uniforms: {
      uAtlas: { value: atlas },
      uAtlasSize: { value: atlasSize },
      uTime: { value: 0 },
      uSway: { value: 0.7 },
      uSun: { value: new THREE.Vector3(0.45, 0.75, 0.48).normalize() },
      uShadow: { value: vec3From(palette.shadow) },
      uSkyFill: { value: vec3From('#a9b0ee') },
      uBands: { value: new THREE.Vector2(LOOK.bands[0], LOOK.bands[1]) },
      uBandSoft: { value: LOOK.bandSoft },
      uMidDepth: { value: LOOK.midDepth },
      uPx: { value: 1 },
      uHatchGap: { value: LOOK.hatchGap },
      uCross: { value: 1 },
    },
  });
  mat.toneMapped = false;
  return mat;
}

// ---------------------------------------------------------------------------------------------
// The composite
// ---------------------------------------------------------------------------------------------

const COMP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMP_FRAG = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tNormalId;
uniform sampler2D tDepth;
uniform vec2 uTexel;
uniform float uPx;
uniform vec2 uCam;        // near, far
uniform vec3 uRight;      // camera right, scaled by tan(fov/2) * aspect
uniform vec3 uUp;         // camera up, scaled by tan(fov/2)
uniform vec3 uFwd;
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uHaze;
uniform vec2 uFog;
uniform vec3 uInkCol;
uniform vec3 uHatchCol;
uniform float uLine;      // line width, device pixels
uniform float uWobble;    // device pixels
uniform float uFringe;
uniform float uGrain;
uniform float uSeed;
uniform float uHatchInk;
uniform float uFogMax;
uniform float uFarLine;
uniform vec2 uCrease;     // normal difference where a crease starts to ink, and where it is full
uniform vec2 uCreaseFar;  // distance over which creases thin out

varying vec2 vUv;

float viewZ(float d) {
  return uCam.x * uCam.y / (uCam.y - d * (uCam.y - uCam.x));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float creaseK;

// How much of a line belongs between the centre pixel and a neighbour, from id and normal alone.
float edge(vec4 c, vec4 t) {
  float ic = c.a * 255.0;
  float it = t.a * 255.0;
  if (it > 254.5) return 0.0;
  if (abs(ic - it) > 0.5) return 1.0;
  if (ic < 0.5) return 0.0;
  float d = 1.0 - dot(c.xyz * 2.0 - 1.0, t.xyz * 2.0 - 1.0);
  return smoothstep(uCrease.x, uCrease.y, d) * creaseK;
}

void main() {
  vec2 css = gl_FragCoord.xy / uPx;

  // The hand is not a ruler. The edge search is read through a slow, fixed ripple, so every line
  // strays a little from true. The ripple is nailed to the page: nothing crawls while the camera rests.
  vec2 wob = vec2(
    sin(css.y * 0.083 + 1.7 * sin(css.x * 0.041)) + 0.5 * sin(css.x * 0.113 + css.y * 0.067),
    sin(css.x * 0.079 + 1.3 * sin(css.y * 0.047) + 2.1) + 0.5 * sin(css.y * 0.127 - css.x * 0.059)
  ) / 1.5;
  vec2 uvE = vUv + wob * uWobble * uTexel;
  // Land on a texel centre. Left on a texel boundary, the centre and its neighbours can round
  // different ways and a stray dot of ink turns up.
  uvE = (floor(uvE / uTexel) + 0.5) * uTexel;

  vec4 c0 = texture2D(tColor, vUv);
  float d0 = texture2D(tDepth, vUv).r;

  vec4 nc = texture2D(tNormalId, uvE);
  float dc = texture2D(tDepth, uvE).r;
  float zc = viewZ(dc);
  creaseK = mix(1.0, 0.3, smoothstep(uCreaseFar.x, uCreaseFar.y, zc));

  float line = 0.0;
  float dNear = dc;

  if (nc.a * 255.0 < 254.5) {
    vec2 ox = vec2(uTexel.x, 0.0);
    vec2 oy = vec2(0.0, uTexel.y);
    vec4 nr = texture2D(tNormalId, uvE + ox);
    vec4 nl = texture2D(tNormalId, uvE - ox);
    vec4 nu = texture2D(tNormalId, uvE + oy);
    vec4 nd = texture2D(tNormalId, uvE - oy);
    float dr = texture2D(tDepth, uvE + ox).r;
    float dl = texture2D(tDepth, uvE - ox).r;
    float du = texture2D(tDepth, uvE + oy).r;
    float dd = texture2D(tDepth, uvE - oy).r;

    // Depth is stored so that it runs straight across any flat surface, however steeply it is seen.
    // So its second difference is zero on a plane and only jumps at a real step.
    float k = zc * zc * (uCam.y - uCam.x) / (uCam.x * uCam.y);
    float thr = 0.05 + 0.016 * zc;
    float okx = step(nr.a * 255.0, 254.5) * step(nl.a * 255.0, 254.5);
    float oky = step(nu.a * 255.0, 254.5) * step(nd.a * 255.0, 254.5);
    float sx = smoothstep(thr, 2.0 * thr, abs(dr + dl - 2.0 * dc) * k) * okx;
    float sy = smoothstep(thr, 2.0 * thr, abs(du + dd - 2.0 * dc) * k) * oky;
    // A step belongs to the side it is on.
    float stepR = sx * step(abs(dl - dc), abs(dr - dc));
    float stepL = sx - stepR;
    float stepU = sy * step(abs(dd - dc), abs(du - dc));
    float stepD = sy - stepU;

    // The line is uLine pixels wide and sits on the pixel grid: the first pixel on one side takes
    // the first pixel of width, the pixel on the other side the next, then one further out.
    float w1 = clamp(uLine, 0.0, 1.0);
    float w2 = clamp(uLine - 1.0, 0.0, 1.0);
    float w3 = clamp(uLine - 2.0, 0.0, 1.0);

    float eR = max(edge(nc, nr), stepR);
    float eL = max(edge(nc, nl), stepL);
    float eU = max(edge(nc, nu), stepU);
    float eD = max(edge(nc, nd), stepD);
    // Something one pixel thin has an edge on both sides. Let it keep its own colour; the pixels
    // either side still carry its line. Small far things stay coloured specks instead of ink blots.
    float lx = max(eR * w1, eL * w2) * (1.0 - 0.8 * min(eR, eL));
    float ly = max(eU * w1, eD * w2) * (1.0 - 0.8 * min(eU, eD));
    line = max(lx, ly);

    if (w3 > 0.0) {
      vec4 n2r = texture2D(tNormalId, uvE + 2.0 * ox);
      vec4 n2u = texture2D(tNormalId, uvE + 2.0 * oy);
      line = max(line, max(edge(nc, n2r), edge(nc, n2u)) * w3);
    }

    if (uFringe > 0.0) {
      // Corners of the staircase, filled in softly.
      vec4 a = texture2D(tNormalId, uvE + ox + oy);
      vec4 b = texture2D(tNormalId, uvE - ox + oy);
      vec4 c = texture2D(tNormalId, uvE + ox - oy);
      vec4 e = texture2D(tNormalId, uvE - ox - oy);
      float f = max(max(edge(nc, a), edge(nc, b)), max(edge(nc, c), edge(nc, e)));
      line = max(line, f * uFringe * w1);
    }

    dNear = min(dc, min(min(dr, dl), min(du, dd)));
  }

  // Pressure: the pen leans a little harder here and there.
  float press = 0.86 + 0.14 * sin(css.x * 0.031 + css.y * 0.023 + 3.0 * sin(css.y * 0.011));
  float zLine = viewZ(dNear);
  line *= press * mix(1.0, uFarLine, smoothstep(uFog.x, uFog.y, zLine));

  vec3 col;
  if (d0 >= 1.0) {
    // Sky. Three stops, placed by how high the eye is looking through this pixel.
    vec2 ndc = vUv * 2.0 - 1.0;
    float e = normalize(uFwd + uRight * ndc.x + uUp * ndc.y).y;
    col = mix(uHorizon, uMid, smoothstep(0.0, 0.3, e));
    col = mix(col, uTop, smoothstep(0.2, 0.85, e));
    col = mix(col, uHaze, smoothstep(0.0, -0.3, e) * 0.9);
  } else {
    float z0 = viewZ(d0);
    float fog = smoothstep(uFog.x, uFog.y, z0) * uFogMax;
    // Hatching is violet, except on things already darker than the violet, where it goes darker still.
    float luma = dot(c0.rgb, vec3(0.299, 0.587, 0.114));
    vec3 hc = mix(c0.rgb * 0.4, uHatchCol, smoothstep(0.1, 0.25, luma));
    col = mix(c0.rgb, hc, c0.a * uHatchInk * (1.0 - fog));
    col = mix(col, uHaze, fog);
  }

  col = mix(col, uInkCol, line);

  if (uGrain > 0.0) {
    // Paper: a fine tooth and a slower mottle under it.
    vec2 g = css * 0.31 + uSeed * 5.0;
    vec2 gi = floor(g);
    vec2 gf = g - gi;
    gf = gf * gf * (3.0 - 2.0 * gf);
    float mottle = mix(mix(hash(gi), hash(gi + vec2(1.0, 0.0)), gf.x), mix(hash(gi + vec2(0.0, 1.0)), hash(gi + vec2(1.0, 1.0)), gf.x), gf.y);
    float n = hash(floor(css) + uSeed * 17.0) * 0.45 + mottle * 0.55;
    col *= 1.0 + uGrain * (n - 0.5) * 2.0;
  }

  gl_FragColor = vec4(col, 1.0);
}
`;

const QUALITY: Record<QualityTier, { cross: number; fringe: number; grain: number }> = {
  low: { cross: 0, fringe: 0, grain: 0 },
  medium: { cross: 1, fringe: 0.34, grain: LOOK.grain },
  high: { cross: 1, fringe: 0.34, grain: LOOK.grain },
};

function setHexVec(v: THREE.Vector3, c: ColorLike): void {
  const h = toHex(c);
  v.set((h >> 16) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
}

/** Returns null when WebGL2 is not there. The caller shows its fallback. */
export function createInk(canvas: HTMLCanvasElement, tier: QualityTier): Ink | null {
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.shadowMap.enabled = false;
  renderer.info.autoReset = false;
  renderer.setClearColor(0x000000, 0);

  const lettering = createLettering();
  const material = createInkMaterial(lettering.texture, lettering.texture.image.width as number);
  const kit = createKit(material, lettering);
  const inkU = material.uniforms;

  const depthTexture = new THREE.DepthTexture(1, 1);
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;
  const target = new THREE.WebGLRenderTarget(1, 1, {
    count: 2,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture,
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    samples: 0,
    colorSpace: THREE.NoColorSpace,
  });

  const comp = new THREE.ShaderMaterial({
    name: 'ink-composite',
    vertexShader: COMP_VERT,
    fragmentShader: COMP_FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      tColor: { value: target.textures[0] },
      tNormalId: { value: target.textures[1] },
      tDepth: { value: depthTexture },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uPx: { value: 1 },
      uCam: { value: new THREE.Vector2(0.1, 1000) },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uFwd: { value: new THREE.Vector3(0, 0, -1) },
      uTop: { value: vec3From('#5a64cc') },
      uMid: { value: vec3From('#a9b0ee') },
      uHorizon: { value: vec3From('#f8dcc6') },
      uHaze: { value: vec3From('#f3d2c4') },
      uFog: { value: new THREE.Vector2(60, 700) },
      uInkCol: { value: vec3From(palette.ink) },
      uHatchCol: { value: vec3From(palette.shadow) },
      uLine: { value: LOOK.line },
      uWobble: { value: LOOK.wobble },
      uFringe: { value: 0.34 },
      uGrain: { value: LOOK.grain },
      uSeed: { value: 0 },
      uHatchInk: { value: LOOK.hatchInk },
      uFogMax: { value: LOOK.fogMax },
      uFarLine: { value: LOOK.farLine },
      uCrease: { value: new THREE.Vector2(0.14, 0.32) },
      uCreaseFar: { value: new THREE.Vector2(50, 220) },
    },
  });
  comp.toneMapped = false;
  const cu = comp.uniforms;

  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const tri = new THREE.Mesh(triGeo, comp);
  tri.frustumCulled = false;
  const triCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  let lost = false;
  let still = false;
  let calm = false;
  const sway = inkU.uSway.value as number;
  const count = { calls: 0, triangles: 0 };
  let pr = 1;
  let sizeW = 0;
  let sizeH = 0;
  let sizePr = 0;

  function setQuality(t: QualityTier): void {
    const q = QUALITY[t];
    inkU.uCross.value = q.cross;
    cu.uFringe.value = q.fringe;
    cu.uGrain.value = q.grain;
  }
  setQuality(tier);

  function setSize(width: number, height: number, pixelRatio: number): void {
    // A tier change calls this with the same numbers. Resizing reallocates the drawing buffer, so skip it.
    if (width === sizeW && height === sizeH && pixelRatio === sizePr) return;
    sizeW = width;
    sizeH = height;
    sizePr = pixelRatio;
    pr = pixelRatio;
    // One call sets the canvas size once. setPixelRatio followed by setSize would set it twice.
    renderer.setDrawingBufferSize(width, height, pixelRatio);
    const w = Math.max(1, Math.floor(width * pixelRatio));
    const h = Math.max(1, Math.floor(height * pixelRatio));
    target.setSize(w, h);
    (cu.uTexel.value as THREE.Vector2).set(1 / w, 1 / h);
    cu.uPx.value = pr;
    cu.uLine.value = Math.max(0.9, LOOK.line * pr);
    cu.uWobble.value = LOOK.wobble * pr;
    inkU.uPx.value = pr;
  }

  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    // three rebuilds its own state. The atlas canvas still holds the letters; just send it again.
    lettering.texture.needsUpdate = true;
    // three also forgets the clear colour. Alpha has to clear to 0 or the sky reads as "no outline"
    // and every skyline loses its line.
    renderer.setClearColor(0x000000, 0);
    lost = false;
  };
  canvas.addEventListener('webglcontextlost', onLost, false);
  canvas.addEventListener('webglcontextrestored', onRestored, false);

  setSize(canvas.clientWidth || canvas.width || 1, canvas.clientHeight || canvas.height || 1, 1);

  return {
    renderer,
    kit,
    setSky(c) {
      setHexVec(cu.uTop.value as THREE.Vector3, c.top);
      setHexVec(cu.uMid.value as THREE.Vector3, c.mid);
      setHexVec(cu.uHorizon.value as THREE.Vector3, c.horizon);
      setHexVec(cu.uHaze.value as THREE.Vector3, c.haze);
      setHexVec(inkU.uSkyFill.value as THREE.Vector3, c.mid);
    },
    setSun(dir) {
      (inkU.uSun.value as THREE.Vector3).copy(dir).normalize();
    },
    setFog(near, far) {
      (cu.uFog.value as THREE.Vector2).set(near, Math.max(far, near + 0.001));
    },
    setSize,
    setQuality,
    setStill(s) {
      still = s;
    },
    setCalm(on) {
      calm = on;
      inkU.uSway.value = on ? 0 : sway;
    },
    render(scene, camera, timeSeconds) {
      if (lost) return;
      renderer.info.reset();
      inkU.uTime.value = still ? 0 : timeSeconds;
      cu.uSeed.value = still || calm ? 1 : 1 + (Math.floor(timeSeconds * 8) % 61);

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);

      const t = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
      const e = camera.matrixWorld.elements;
      (cu.uRight.value as THREE.Vector3).set(e[0], e[1], e[2]).multiplyScalar(t * camera.aspect);
      (cu.uUp.value as THREE.Vector3).set(e[4], e[5], e[6]).multiplyScalar(t);
      (cu.uFwd.value as THREE.Vector3).set(-e[8], -e[9], -e[10]);
      (cu.uCam.value as THREE.Vector2).set(camera.near, camera.far);

      renderer.setRenderTarget(null);
      renderer.render(tri, triCam);
      count.calls = renderer.info.render.calls;
      count.triangles = renderer.info.render.triangles;
    },
    stats() {
      return count;
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost, false);
      canvas.removeEventListener('webglcontextrestored', onRestored, false);
      target.dispose();
      depthTexture.dispose();
      triGeo.dispose();
      comp.dispose();
      kit.dispose();
      material.dispose();
      lettering.dispose();
      renderer.dispose();
    },
  };
}
