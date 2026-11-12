// The real look's picture, after the scene is drawn: the sky behind everything, a restrained bloom
// on the high tier, then one output pass that develops the frame (exposure, the AgX curve the bake
// was judged under, sRGB, a little lens falloff and grain) and, during a change-over, joins it to
// the ink page.
//
// The scene is drawn in linear light into a half float target with a depth buffer of its own. The
// canvas has neither depth nor antialiasing, because the ink look needs neither.
//
// During a change-over the ink page is drawn to the canvas first, exactly as the ink look draws it,
// and this pass lays the developed frame over it with a coverage of its own. The ink page never goes
// into a target of mine: that would make three.js build a second copy of the ink program (it writes
// a target in another colour space than the screen), and that copy would stay for the rest of the visit.
import * as THREE from 'three';

const TRI_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

// ---------------------------------------------------------------------------------------------
// Sky: the baked sky as the background, with the sun's disc drawn sharp where the bake put it.
// The file is 512 pixels round the whole horizon, enough for the gradient and too soft for a sun.
// ---------------------------------------------------------------------------------------------

const SKY_VERT = /* glsl */ `
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
varying vec3 vDir;
void main() {
  vDir = uFwd + uRight * position.x + uUp * position.y;
  gl_Position = vec4( position.xy, 1.0, 1.0 );
}
`;

const SKY_FRAG = /* glsl */ `
#include <common>
uniform sampler2D tSky;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  vec3 sky = texture2D( tSky, equirectUv( d ) ).rgb;
  // The file's own sun is a soft blob a few texels wide. Hold the sky under it down and draw the disc here.
  float c = dot( d, uSunDir );
  float ang = acos( clamp( c, - 1.0, 1.0 ) );
  float near = smoothstep( 0.11, 0.03, ang );
  sky = mix( sky, min( sky, vec3( 9.0, 6.5, 3.6 ) ), near );
  float disc = smoothstep( 0.0125, 0.0095, ang );
  float halo = exp( - ang * 26.0 ) * 0.9 + exp( - ang * 7.0 ) * 0.12;
  sky += uSunColor * ( disc * 90.0 + halo * 9.0 );
  // Alpha 0 marks open sky for the output pass. Everything drawn over it writes 1.
  gl_FragColor = vec4( sky, 0.0 );
}
`;

// ---------------------------------------------------------------------------------------------
// Bloom: bright parts only, down a short chain of half sizes and back up.
// ---------------------------------------------------------------------------------------------

const BLOOM_DOWN = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uFirst;
varying vec2 vUv;
vec3 bright( vec3 c ) {
  // Fireflies off the sun's reflection would smear into blobs: cap, then keep what is over the knee.
  c = min( c, vec3( 24.0 ) );
  float l = max( c.r, max( c.g, c.b ) );
  float k = max( l - 1.15, 0.0 );
  return c * ( k / max( l, 1e-4 ) );
}
vec3 tap( vec2 uv ) {
  vec3 c = texture2D( tSrc, uv ).rgb;
  return uFirst > 0.5 ? bright( c ) : c;
}
void main() {
  vec2 o = uTexel;
  vec3 c = tap( vUv ) * 4.0;
  c += tap( vUv + vec2( - o.x, - o.y ) );
  c += tap( vUv + vec2( o.x, - o.y ) );
  c += tap( vUv + vec2( - o.x, o.y ) );
  c += tap( vUv + vec2( o.x, o.y ) );
  gl_FragColor = vec4( c / 8.0, 1.0 );
}
`;

const BLOOM_UP = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec2 o = uTexel * 0.5;
  vec3 c = texture2D( tSrc, vUv + vec2( - o.x * 2.0, 0.0 ) ).rgb;
  c += texture2D( tSrc, vUv + vec2( o.x * 2.0, 0.0 ) ).rgb;
  c += texture2D( tSrc, vUv + vec2( 0.0, - o.y * 2.0 ) ).rgb;
  c += texture2D( tSrc, vUv + vec2( 0.0, o.y * 2.0 ) ).rgb;
  c += texture2D( tSrc, vUv + vec2( - o.x, o.y ) ).rgb * 2.0;
  c += texture2D( tSrc, vUv + vec2( o.x, o.y ) ).rgb * 2.0;
  c += texture2D( tSrc, vUv + vec2( - o.x, - o.y ) ).rgb * 2.0;
  c += texture2D( tSrc, vUv + vec2( o.x, - o.y ) ).rgb * 2.0;
  gl_FragColor = vec4( c / 12.0, 1.0 );
}
`;

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

const OUT_FRAG = /* glsl */ `
uniform sampler2D tReal;
uniform sampler2D tBloom;
uniform sampler2D tDepth;
uniform float uExposure;
uniform float uBloom;
uniform float uJoin;      // 1 during a change-over
uniform float uMix;       // how far the change-over has come, 0..1
uniform float uToReal;    // 1 when the real look is arriving, 0 when the ink look is
uniform vec2 uCam;        // near, far of the camera the ink page was drawn with
uniform float uVignette;
uniform float uGrain;
uniform vec2 uGrade;      // how much the lit side warms and the shade cools
uniform float uSeed;
uniform float uPx;
uniform vec3 uTintTop;
uniform vec3 uTintMid;
uniform vec3 uTintHorizon;
uniform vec3 uTint;       // at the horizon, overhead, how much of the photograph's brightness is kept
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform vec3 uSunDir;
#ifdef LS_LUT
uniform sampler2D tLut;
uniform vec3 uLut;        // size, log2 low end, log2 high end
#endif
varying vec2 vUv;

// The AgX curve as three.js ships it (after Filament and Blender), with my own exposure in front.
const mat3 LINEAR_REC2020_TO_LINEAR_SRGB = mat3(
  vec3( 1.6605, - 0.1246, - 0.0182 ),
  vec3( - 0.5876, 1.1329, - 0.1006 ),
  vec3( - 0.0728, - 0.0083, 1.1187 )
);
const mat3 LINEAR_SRGB_TO_LINEAR_REC2020 = mat3(
  vec3( 0.6274, 0.0691, 0.0164 ),
  vec3( 0.3293, 0.9195, 0.0880 ),
  vec3( 0.0433, 0.0113, 0.8956 )
);
vec3 agxContrast( vec3 x ) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx( vec3 color ) {
  const mat3 inset = mat3(
    vec3( 0.856627153315983, 0.137318972929847, 0.11189821299995 ),
    vec3( 0.0951212405381588, 0.761241990602591, 0.0767994186031903 ),
    vec3( 0.0482516061458583, 0.101439036467562, 0.811302368396859 )
  );
  const mat3 outset = mat3(
    vec3( 1.1271005818144368, - 0.1413297634984383, - 0.14132976349843826 ),
    vec3( - 0.11060664309660323, 1.157823702216272, - 0.11060664309660294 ),
    vec3( - 0.016493938717834573, - 0.016493938717834257, 1.2519364065950405 )
  );
  const float minEv = - 12.47393;
  const float maxEv = 4.026069;
  color = LINEAR_SRGB_TO_LINEAR_REC2020 * color;
  color = inset * color;
  color = max( color, 1e-10 );
  color = log2( color );
  color = ( color - minEv ) / ( maxEv - minEv );
  color = clamp( color, 0.0, 1.0 );
  color = agxContrast( color );
  color = outset * color;
  color = pow( max( vec3( 0.0 ), color ), vec3( 2.2 ) );
  color = LINEAR_REC2020_TO_LINEAR_SRGB * color;
  return clamp( color, 0.0, 1.0 );
}
vec3 toSrgb( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}
float hash( vec2 p ) {
  vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
  p3 += dot( p3, p3.yzx + 33.33 );
  return fract( ( p3.x + p3.y ) * p3.z );
}

void main() {
  vec4 frame = texture2D( tReal, vUv );
  vec3 hdr = frame.rgb;
#ifdef LS_BLOOM
  hdr += texture2D( tBloom, vUv ).rgb * uBloom;
#endif
  // A lens lets a little less light through toward its corners.
  vec2 q = vUv - 0.5;
  hdr *= 1.0 - uVignette * dot( q, q ) * 2.0;
#ifdef LS_LUT
  // Blender's own AgX, from the table the bake shipped. The bake was judged under it; three's fitted
  // curve is up to 14 levels brighter in shade.
  vec3 col;
  {
    float n = uLut.x;
    vec3 c = hdr * uExposure;
    vec3 t = clamp( ( log2( max( c, vec3( 1e-10 ) ) ) - uLut.y ) / ( uLut.z - uLut.y ), 0.0, 1.0 ) * ( n - 1.0 );
    float b0 = floor( t.b );
    float b1 = min( b0 + 1.0, n - 1.0 );
    vec2 pa = vec2( ( t.r + 0.5 + b0 * n ) / ( n * n ), ( t.g + 0.5 ) / n );
    vec2 pb = vec2( ( t.r + 0.5 + b1 * n ) / ( n * n ), ( t.g + 0.5 ) / n );
    col = mix( texture2D( tLut, pa ).rgb, texture2D( tLut, pb ).rgb, t.b - b0 );
  }
#else
  vec3 col = toSrgb( agx( hdr * uExposure ) );
#endif
  // Late sun on film: the lit side of things runs warm and the shade a little cool, the way the
  // drawing puts violet in its shade. Only on things: the open sky is left alone, and white stays white.
  {
    float solid = clamp( frame.a, 0.0, 1.0 );
    float l = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
    float lit = smoothstep( 0.3, 0.75, l ) * ( 1.0 - smoothstep( 0.88, 1.0, l ) );
    float shade = 1.0 - smoothstep( 0.05, 0.35, l );
    // Not on green: warming a lawn or a crown only turns it mustard. The island is meant to be grown over.
    lit *= 1.0 - 0.75 * clamp( ( col.g - max( col.r, col.b ) ) * 6.0, 0.0, 1.0 );
    col *= mix( vec3( 1.0 ), vec3( 1.05, 1.0, 0.87 ), lit * uGrade.x * solid );
    col *= mix( vec3( 1.0 ), vec3( 0.95, 0.97, 1.08 ), shade * uGrade.y * solid );
  }
  // Each district has its own sky in the drawing: amber over the Switchboard, red over the Mask
  // Garden, teal over Sky Harbor, pink over the Studio, peach over Postcards. The baked sky is one
  // sky. Where the frame is open sky (alpha 0), its developed colour leans toward the drawn gradient
  // over where he stands: most at the horizon, less overhead, not at all round the sun. Done here,
  // after the curve, because the curve would turn any strong sky colour to cream.
  {
    float open = 1.0 - clamp( frame.a, 0.0, 1.0 );
    if ( open > 0.0 && uTint.x + uTint.y > 0.0 ) {
      vec3 d = normalize( uFwd + uRight * ( vUv.x * 2.0 - 1.0 ) + uUp * ( vUv.y * 2.0 - 1.0 ) );
      float y = d.y;
      vec3 hue = mix( uTintHorizon, uTintMid, smoothstep( 0.03, 0.38, y ) );
      hue = mix( hue, uTintTop, smoothstep( 0.42, 0.95, y ) );
      float w = mix( uTint.x, uTint.y, smoothstep( 0.0, 0.6, abs( y ) ) );
      w *= 1.0 - smoothstep( 0.93, 0.995, dot( d, uSunDir ) );
      const vec3 Y = vec3( 0.2126, 0.7152, 0.0722 );
      vec3 t = clamp( hue * mix( 1.0, dot( col, Y ) / max( dot( hue, Y ), 1e-3 ), uTint.z ), 0.0, 1.0 );
      col = mix( col, t, w * open );
    }
  }
  col += ( hash( floor( gl_FragCoord.xy / uPx ) + uSeed * 17.0 ) - 0.5 ) * uGrain;

  float cover = 1.0;
  if ( uJoin > 0.5 ) {
  // The change-over. The arriving look spreads out from where the visitor stands: near things turn
  // first, the far skyline next, the sky last. Depth is on a log scale so the front moves evenly.
  // The ink page is already on the canvas under this pass. What goes on top is this frame, as much
  // of it as the front has uncovered, and the seam.
  float d = texture2D( tDepth, vUv ).r;
  float z = d >= 1.0 ? 1.0e5 : uCam.x * uCam.y / ( uCam.y - d * ( uCam.y - uCam.x ) );
  float t = clamp( log( max( z, 1.5 ) / 1.5 ) / log( 800.0 ), 0.0, 1.0 );
  // The front is not a ruler either: it runs a little ahead here and a little behind there.
  t += ( hash( floor( gl_FragCoord.xy / ( uPx * 3.0 ) ) ) - 0.5 ) * 0.035;
  float w = smoothstep( 0.0, 0.14, uMix * 1.18 - t - 0.02 );
  cover = uToReal > 0.5 ? w : 1.0 - w;
  // A thin seam of light rides the front.
  col = col * cover + vec3( 1.0, 0.86, 0.62 ) * ( w * ( 1.0 - w ) ) * 0.55;
  }
  // Blended as premultiplied: this frame times its cover, plus what is under it times the rest.
  // Out of a change-over the cover is 1 and what is under counts for nothing.
  gl_FragColor = vec4( col, cover );
}
`;

export interface Post {
  /** The scene is drawn into this. */
  target: THREE.WebGLRenderTarget;
  /** Goes into the scene, drawn first. */
  sky: THREE.Mesh;
  setSize(width: number, height: number, pixelRatio: number): void;
  setSamples(samples: number): void;
  setBloom(on: boolean): void;
  /** The drawn sky's three stops as authored (sRGB, 0..1), how far open sky leans toward them at the
   *  horizon and overhead, and how much of the photograph's own brightness it keeps. */
  setTint(top: THREE.Vector3, mid: THREE.Vector3, horizon: THREE.Vector3, low: number, high: number, keep: number): void;
  /** Set a uniform of the sky or the output pass by name. For tuning. */
  tune(name: string, value: number | readonly number[]): boolean;
  bloom(): boolean;
  samples(): number;
  /** Bloom if it is on, then the output pass to the screen. `mix` below 1 lays the frame over the ink
   *  page already on the canvas; `inkDepth` is that page's depth, which the front follows. */
  present(renderer: THREE.WebGLRenderer, mix: number, toReal: boolean, inkDepth: THREE.Texture | null, camera: THREE.PerspectiveCamera, time: number, still: boolean): void;
  dispose(): void;
}

const BLOOM_LEVELS = 5;

/** The tone curve as a table (Blender's AgX), when the bake ships one. */
export interface Lut {
  texture: THREE.Texture;
  size: number;
  logMin: number;
  logMax: number;
}

export function createPost(skyTexture: THREE.Texture, sunDir: THREE.Vector3, sunColor: THREE.Vector3, exposure: number, lut: Lut | null): Post {
  let w = 1;
  let h = 1;
  let pr = 1;
  let samples = 0;
  let bloomOn = false;

  const makeTarget = (): THREE.WebGLRenderTarget =>
    new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
      depthBuffer: true,
      stencilBuffer: false,
      samples,
    });
  let target = makeTarget();
  const chain: THREE.WebGLRenderTarget[] = [];

  const triGeo = new THREE.BufferGeometry();
  triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const triCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const pass = (fragmentShader: string, uniforms: Record<string, THREE.IUniform>, vertexShader = TRI_VERT): THREE.ShaderMaterial => {
    const m = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, depthTest: false, depthWrite: false });
    m.toneMapped = false;
    return m;
  };

  // Sky. A full screen triangle at the far plane, in the scene so the edges of everything blend against it.
  const skyMat = pass(
    SKY_FRAG,
    {
      tSky: { value: skyTexture },
      uSunDir: { value: sunDir.clone().normalize() },
      uSunColor: { value: sunColor.clone() },
      uRight: { value: new THREE.Vector3(1, 0, 0) },
      uUp: { value: new THREE.Vector3(0, 1, 0) },
      uFwd: { value: new THREE.Vector3(0, 0, -1) },
    },
    SKY_VERT,
  );
  skyMat.name = 'real-sky';
  const sky = new THREE.Mesh(triGeo, skyMat);
  sky.name = 'real-sky';
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  sky.onBeforeRender = (_r, _s, camera) => {
    const cam = camera as THREE.PerspectiveCamera;
    if (!cam.isPerspectiveCamera) return;
    const t = Math.tan((cam.fov * Math.PI) / 360) / cam.zoom;
    const e = cam.matrixWorld.elements;
    (skyMat.uniforms.uRight.value as THREE.Vector3).set(e[0], e[1], e[2]).multiplyScalar(t * cam.aspect);
    (skyMat.uniforms.uUp.value as THREE.Vector3).set(e[4], e[5], e[6]).multiplyScalar(t);
    (skyMat.uniforms.uFwd.value as THREE.Vector3).set(-e[8], -e[9], -e[10]);
  };

  const down = pass(BLOOM_DOWN, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 } });
  const up = pass(BLOOM_UP, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
  up.blending = THREE.AdditiveBlending;
  up.transparent = true;
  const out = pass(OUT_FRAG, {
    tReal: { value: target.texture },
    // A sampler with nothing on it makes three.js bind a blank texture of its own, which then stays
    // on the card for good. The frame itself is always there to stand in.
    tBloom: { value: target.texture },
    tDepth: { value: target.texture },
    uExposure: { value: exposure },
    uBloom: { value: 0.07 },
    uJoin: { value: 0 },
    uMix: { value: 1 },
    uToReal: { value: 1 },
    uCam: { value: new THREE.Vector2(0.3, 3000) },
    uVignette: { value: 0.1 },
    uGrain: { value: 0.012 },
    uGrade: { value: new THREE.Vector2(1, 1) },
    uSeed: { value: 1 },
    uPx: { value: 1 },
    uTintTop: { value: new THREE.Vector3(1, 1, 1) },
    uTintMid: { value: new THREE.Vector3(1, 1, 1) },
    uTintHorizon: { value: new THREE.Vector3(1, 1, 1) },
    uTint: { value: new THREE.Vector3(0, 0, 0.5) },
    uRight: { value: new THREE.Vector3(1, 0, 0) },
    uUp: { value: new THREE.Vector3(0, 1, 0) },
    uFwd: { value: new THREE.Vector3(0, 0, -1) },
    uSunDir: { value: sunDir.clone().normalize() },
  });
  out.blending = THREE.CustomBlending;
  out.blendEquation = THREE.AddEquation;
  out.blendSrc = THREE.OneFactor;
  out.blendDst = THREE.OneMinusSrcAlphaFactor;
  out.blendSrcAlpha = THREE.OneFactor;
  out.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  if (lut) {
    out.defines = { ...(out.defines ?? {}), LS_LUT: '' };
    out.uniforms.tLut = { value: lut.texture };
    out.uniforms.uLut = { value: new THREE.Vector3(lut.size, lut.logMin, lut.logMax) };
  }
  const quad = new THREE.Mesh(triGeo, out);
  quad.frustumCulled = false;

  function sizeChain(): void {
    for (const t of chain) t.dispose();
    chain.length = 0;
    if (!bloomOn) return;
    let cw = Math.max(2, w >> 1);
    let ch = Math.max(2, h >> 1);
    for (let i = 0; i < BLOOM_LEVELS && cw >= 4 && ch >= 4; i++) {
      chain.push(
        new THREE.WebGLRenderTarget(cw, ch, {
          type: THREE.HalfFloatType,
          format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          generateMipmaps: false,
          depthBuffer: false,
          stencilBuffer: false,
        }),
      );
      cw = Math.max(2, cw >> 1);
      ch = Math.max(2, ch >> 1);
    }
  }

  function draw(renderer: THREE.WebGLRenderer, material: THREE.ShaderMaterial, into: THREE.WebGLRenderTarget | null): void {
    quad.material = material;
    renderer.setRenderTarget(into);
    renderer.render(quad, triCam);
  }

  function setDefine(name: string, on: boolean): void {
    const has = out.defines !== undefined && name in out.defines;
    if (has === on) return;
    out.defines = { ...(out.defines ?? {}) };
    if (on) out.defines[name] = '';
    else delete out.defines[name];
    out.needsUpdate = true;
  }

  return {
    get target() {
      return target;
    },
    sky,
    setSize(width, height, pixelRatio) {
      const nw = Math.max(1, Math.floor(width * pixelRatio));
      const nh = Math.max(1, Math.floor(height * pixelRatio));
      pr = pixelRatio;
      out.uniforms.uPx.value = pr;
      if (nw === w && nh === h) return;
      w = nw;
      h = nh;
      target.setSize(w, h);
      sizeChain();
    },
    setSamples(n) {
      if (n === samples) return;
      samples = n;
      target.dispose();
      target = makeTarget();
      out.uniforms.tReal.value = target.texture;
    },
    setBloom(on) {
      if (on === bloomOn) return;
      bloomOn = on;
      sizeChain();
    },
    tune(name, value) {
      const target = skyMat.uniforms[name] ?? out.uniforms[name];
      if (!target) return false;
      if (typeof value === 'number') target.value = value;
      else (target.value as { fromArray(a: readonly number[]): void }).fromArray(value);
      return true;
    },
    setTint(top, mid, horizon, low, high, keep) {
      const ou = out.uniforms;
      (ou.uTintTop.value as THREE.Vector3).copy(top);
      (ou.uTintMid.value as THREE.Vector3).copy(mid);
      (ou.uTintHorizon.value as THREE.Vector3).copy(horizon);
      (ou.uTint.value as THREE.Vector3).set(low, high, keep);
    },
    bloom: () => bloomOn,
    samples: () => samples,
    present(renderer, mix, toReal, inkDepth, camera, time, still) {
      const bloom = bloomOn && chain.length > 1;
      if (bloom) {
        // Down: the bright parts of the frame into the first level, then each level into the next.
        let src: THREE.Texture = target.texture;
        let sw = w;
        let sh = h;
        for (let i = 0; i < chain.length; i++) {
          down.uniforms.tSrc.value = src;
          (down.uniforms.uTexel.value as THREE.Vector2).set(1 / sw, 1 / sh);
          down.uniforms.uFirst.value = i === 0 ? 1 : 0;
          draw(renderer, down, chain[i]);
          src = chain[i].texture;
          sw = chain[i].width;
          sh = chain[i].height;
        }
        // Up: each level added onto the one above it. The clear must not wipe what is there.
        const auto = renderer.autoClear;
        renderer.autoClear = false;
        for (let i = chain.length - 1; i > 0; i--) {
          up.uniforms.tSrc.value = chain[i].texture;
          (up.uniforms.uTexel.value as THREE.Vector2).set(1 / chain[i].width, 1 / chain[i].height);
          draw(renderer, up, chain[i - 1]);
        }
        renderer.autoClear = auto;
        out.uniforms.tBloom.value = chain[0].texture;
      }
      setDefine('LS_BLOOM', bloom);
      const joining = mix < 1 && inkDepth !== null;
      out.uniforms.uJoin.value = joining ? 1 : 0;
      out.uniforms.tDepth.value = joining ? inkDepth : target.texture;
      if (!bloom) out.uniforms.tBloom.value = target.texture;
      out.uniforms.uMix.value = toReal ? mix : 1 - mix;
      out.uniforms.uToReal.value = toReal ? 1 : 0;
      (out.uniforms.uCam.value as THREE.Vector2).set(camera.near, camera.far);
      {
        const t = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom;
        const e = camera.matrixWorld.elements;
        (out.uniforms.uRight.value as THREE.Vector3).set(e[0], e[1], e[2]).multiplyScalar(t * camera.aspect);
        (out.uniforms.uUp.value as THREE.Vector3).set(e[4], e[5], e[6]).multiplyScalar(t);
        (out.uniforms.uFwd.value as THREE.Vector3).set(-e[8], -e[9], -e[10]);
      }
      out.uniforms.uSeed.value = still ? 1 : 1 + (Math.floor(time * 24) % 61);
      // The canvas holds the ink page during a change-over. Clearing it would lose that.
      const auto = renderer.autoClear;
      renderer.autoClear = !joining;
      draw(renderer, out, null);
      renderer.autoClear = auto;
    },
    dispose() {
      target.dispose();
      for (const t of chain) t.dispose();
      chain.length = 0;
      triGeo.dispose();
      skyMat.dispose();
      down.dispose();
      up.dispose();
      out.dispose();
    },
  };
}
