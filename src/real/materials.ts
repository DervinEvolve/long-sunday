// Materials of the real look. Two families.
//
// Baked: standard three.js materials built from the manifest, lit by their lightmap and nothing
// else. The sky is on them for reflections only. They read the sun's small shadow map so that the
// figure throws a shadow on baked ground, but take no light from the sun lamp itself.
//
// Stand-in: one standard material that reads the ink kit's own vertex attributes (aColor, aData,
// aInk). Everything that moves is drawn with it, and so is the ink geometry of a chunk whose baked
// version has not arrived yet. It is lit by the sun lamp and a sky light that match the bake.
//
// Both families fade into the same haze, coloured from the baked sky.
import * as THREE from 'three';
import type { Manifest, ManifestMaterial } from './api';

/** Uniform objects shared by every material of the real look. Change a value here and all follow. */
export interface SharedUniforms {
  uTime: THREE.IUniform<number>;
  uSway: THREE.IUniform<number>;
  /** near, far, most. The same distances the ink haze uses. */
  uHaze: THREE.IUniform<THREE.Vector3>;
  /** The sun's compass direction, x and z, unit length. */
  uHazeSun: THREE.IUniform<THREE.Vector2>;
  uHazeToward: THREE.IUniform<THREE.Vector3>;
  uHazeAway: THREE.IUniform<THREE.Vector3>;
  /** Sky light on a face that looks up, and on one that looks down. Irradiance, the lightmaps' units. */
  uSkyUp: THREE.IUniform<THREE.Vector3>;
  uSkyDown: THREE.IUniform<THREE.Vector3>;
  uAtlas: THREE.IUniform<THREE.Texture | null>;
  uAtlasSize: THREE.IUniform<number>;
  /** Radiance of a fully flat (self lit) white stand-in surface. */
  uGlow: THREE.IUniform<number>;
  /** Extra radiance on baked lamp glass, on top of what the lightmap gives it. */
  uLamp: THREE.IUniform<number>;
  /** 1 while the light on the ground is being mapped from above: baked surfaces then write out their light alone. */
  uProbe: THREE.IUniform<number>;
  /** Toward the sun, world space, and what it puts on a surface that faces it. For the sun's glint on baked surfaces. */
  uSunDir: THREE.IUniform<THREE.Vector3>;
  uSunE: THREE.IUniform<THREE.Vector3>;
  /** x: how much of the mirrored sky baked surfaces show. y: how much of the sun's glint. z: how hard
   *  a face that the baked light says is closed in loses its mirrored sky (0 not at all). w: how much
   *  of the low sky the town hides from a mirror at street level (0 none of it). */
  uShine: THREE.IUniform<THREE.Vector4>;
  /** How much the texture library's own occlusion (joints, cracks, the gaps between blades) takes off the baked light in shade. */
  uAo: THREE.IUniform<number>;
  /** What the sun's light on a thing that moves is multiplied by: half of the low sun's colour taken back out. */
  uSunKeep: THREE.IUniform<THREE.Vector3>;
}

/** How much sun and sky reach one thing that moves. The figure has its own, measured under his feet. */
export interface Exposure {
  /** Sun at his feet, sun at his head, and the two heights between which it blends. */
  uSunVis: THREE.IUniform<THREE.Vector4>;
  /** Share of the open sky's light. Under an arch there is less. */
  uAmb: THREE.IUniform<number>;
}

export const openAir = (): Exposure => ({ uSunVis: { value: new THREE.Vector4(1, 1, 0, 1) }, uAmb: { value: 1 } });

export function sharedUniforms(inkMaterial: THREE.Material): SharedUniforms {
  const iu = (inkMaterial as THREE.ShaderMaterial).uniforms;
  const atlas = (iu.uAtlas?.value as THREE.Texture | undefined) ?? null;
  return {
    // The very same objects the ink material holds, so sway keeps time in both looks and stops
    // with reduced motion and with ?still=1.
    uTime: iu.uTime as THREE.IUniform<number>,
    uSway: iu.uSway as THREE.IUniform<number>,
    uHaze: { value: new THREE.Vector3(45, 620, 0.6) },
    uHazeSun: { value: new THREE.Vector2(1, 0) },
    uHazeToward: { value: new THREE.Vector3(1, 1, 1) },
    uHazeAway: { value: new THREE.Vector3(1, 1, 1) },
    uSkyUp: { value: new THREE.Vector3(1, 1, 1) },
    uSkyDown: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
    uAtlas: { value: atlas },
    uAtlasSize: { value: (iu.uAtlasSize?.value as number | undefined) ?? 2048 },
    uGlow: { value: 2.4 },
    uLamp: { value: 1.2 },
    uProbe: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunE: { value: new THREE.Vector3(0, 0, 0) },
    uShine: { value: new THREE.Vector4(1, 1, 2, 1) },
    uAo: { value: 0.4 },
    uSunKeep: { value: new THREE.Vector3(1, 1, 1) },
  };
}

// ---------------------------------------------------------------------------------------------
// Shader pieces
// ---------------------------------------------------------------------------------------------

const HAZE_PARS = /* glsl */ `
#ifndef LS_HAZE_K
#define LS_HAZE_K 1.0
#endif
uniform vec3 uHaze;
uniform vec2 uHazeSun;
uniform vec3 uHazeToward;
uniform vec3 uHazeAway;
`;

// Distance fades into the sky's own horizon colour: warm and bright toward the sun, cooler away from it.
const HAZE = /* glsl */ `
{
  float lsD = length( vViewPosition );
  float lsF = smoothstep( uHaze.x, uHaze.y, lsD ) * uHaze.z * LS_HAZE_K;
  vec3 lsDir = ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz;
  float lsS = max( dot( normalize( lsDir.xz + vec2( 1e-5 ) ), uHazeSun ), 0.0 );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, mix( uHazeAway, uHazeToward, lsS * lsS * lsS ), lsF );
}
`;

// Baked surfaces: no light from lamps. Only ask the sun's shadow map whether something that moves
// stands between this point and the sun.
const BAKED_LIGHTS_BEGIN = /* glsl */ `
vec3 geometryPosition = - vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition );
vec3 geometryClearcoatNormal = vec3( 0.0 );
vec3 iblIrradiance = vec3( 0.0 );
vec3 irradiance = vec3( 0.0 );
vec3 radiance = vec3( 0.0 );
vec3 clearcoatRadiance = vec3( 0.0 );
float lsShade = 1.0;
float lsOpen = 1.0;
vec3 lsAroundLight = uSkyUp;
#if defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow lsShadow = directionalLightShadows[ 0 ];
  lsShade = receiveShadow ? getShadow( directionalShadowMap[ 0 ], lsShadow.shadowMapSize, lsShadow.shadowIntensity, lsShadow.shadowBias, lsShadow.shadowRadius, vDirectionalShadowCoord[ 0 ] ) : 1.0;
#endif
`;

// The lightmap holds sun and sky together. Under a moving thing's shadow the sun goes and the sky
// stays: bring the baked light down to what the sky alone would give this face, never up.
const BAKED_LIGHTS_MAPS = /* glsl */ `
#ifdef USE_LIGHTMAP
  vec4 lightMapTexel = texture2D( lightMap, vLightMapUv );
  vec3 lightMapIrradiance = lightMapTexel.rgb * lightMapIntensity;
  vec3 lsBakedLight = lightMapIrradiance;
  if ( lsShade < 0.999 ) {
    float lsUp = ( vec4( geometryNormal, 0.0 ) * viewMatrix ).y * 0.5 + 0.5;
    vec3 lsSky = mix( uSkyDown, uSkyUp, lsUp );
    float lsHave = dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) );
    float lsWant = dot( lsSky, vec3( 0.2126, 0.7152, 0.0722 ) );
    float lsK = min( 1.0, lsWant / max( lsHave, 1e-4 ) );
    vec3 lsShaded = mix( lightMapIrradiance * lsK, lsSky * min( 1.0, lsHave / max( lsWant, 1e-4 ) ), 0.5 * ( 1.0 - lsK ) );
    lightMapIrradiance = mix( lsShaded, lightMapIrradiance, lsShade );
  }
  float lsUp2 = ( vec4( nonPerturbedNormal, 0.0 ) * viewMatrix ).y * 0.5 + 0.5;
  float lsSkyOnly = dot( mix( uSkyDown, uSkyUp, lsUp2 ), vec3( 0.2126, 0.7152, 0.0722 ) );
  float lsBakedLum = dot( lsBakedLight, vec3( 0.2126, 0.7152, 0.0722 ) );
  #ifdef LS_AO
  {
    // The bake lit smooth faces: the relief is only in the normal map. The library's occlusion says
    // where the joints and cracks are. Sky light does not get into them. The low sun mostly does.
    float lsAo = texture2D( roughnessMap, vRoughnessMapUv ).r;
    float lsSunShare = saturate( ( lsBakedLum - lsSkyOnly ) / max( lsBakedLum, 1e-3 ) );
    lightMapIrradiance *= mix( 1.0, lsAo, uAo * ( 1.0 - 0.6 * lsSunShare ) );
  }
  #endif
  irradiance += lightMapIrradiance;
  // The mirrored sky knows nothing of what stands in the way. The baked light does: a face that gets
  // less than the open sky would give it is closed in, by a tree, an arch, a wall across the street,
  // and mirrors that much less sky. Metal bakes to black, so it cannot say, and keeps all of it.
  lsOpen = mix( pow( saturate( lsBakedLum / max( lsSkyOnly, 1e-3 ) ), uShine.z ), 1.0, metalnessFactor );
  lsAroundLight = mix( lsBakedLight, uSkyUp, metalnessFactor );
  // The sun's glint. The sky these surfaces mirror has the sun taken out, because a mirrored sun
  // shows in shade as well as in the open. Here it goes back in where the baked light says the sun
  // reaches: the lightmap holds more than the sky alone could give this face.
  {
    vec3 lsL = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
    float lsFace = saturate( dot( nonPerturbedNormal, lsL ) );
    float lsNL = saturate( dot( geometryNormal, lsL ) );
    if ( lsNL > 0.0 && lsFace > 0.0 ) {
      float lsSunOnly = dot( uSunE, vec3( 0.2126, 0.7152, 0.0722 ) ) * lsFace;
      float lsLit = smoothstep( 0.2, 0.8, ( lsBakedLum - lsSkyOnly ) / max( lsSunOnly, 0.05 ) );
      lsLit = mix( lsLit * smoothstep( 0.0, 0.08, lsFace ), 1.0, metalnessFactor );
      // On a very rough face the glint is a faint sheen at best, and at a low angle the formula overdoes it.
      lsLit *= 1.0 - 0.75 * smoothstep( 0.55, 0.95, material.roughness ) * ( 1.0 - metalnessFactor );
      reflectedLight.directSpecular += uSunE * ( lsNL * lsLit * lsShade * uShine.y ) * BRDF_GGX( lsL, geometryViewDir, geometryNormal, material );
    }
  }
#endif
#if defined( USE_ENVMAP )
  {
    // A mirror at street level does not see the low sky: the town is in the way. Where the mirrored
    // direction runs level or down, it shows the surroundings, and those are about as bright as the
    // light that falls here. A rough surface mirrors a wide patch, so the change is spread out.
    vec3 lsR = reflect( - geometryViewDir, geometryNormal );
    lsR = normalize( mix( lsR, geometryNormal, pow4( material.roughness ) ) );
    float lsRy = ( vec4( lsR, 0.0 ) * viewMatrix ).y;
    float lsWide = 0.15 + 0.6 * material.roughness;
    float lsSkyShare = mix( 1.0, smoothstep( 0.2 - lsWide, 0.2 + lsWide, lsRy ), uShine.w );
    vec3 lsAround = lsAroundLight * ( 0.2 * RECIPROCAL_PI * envMapIntensity );
    radiance += mix( lsAround, getIBLRadiance( geometryViewDir, geometryNormal, material.roughness ) * lsOpen, lsSkyShare ) * uShine.x;
  }
#endif
`;

const BAKED_PARS = /* glsl */ `
uniform vec3 uSkyUp;
uniform vec3 uSkyDown;
uniform float uTime;
uniform float uSway;
uniform float uLamp;
uniform float uProbe;
uniform vec3 uSunDir;
uniform vec3 uSunE;
uniform vec4 uShine;
uniform float uAo;
`;

// While the ground's light is mapped from above, a baked surface answers with its light and nothing else.
const BAKED_PROBE = /* glsl */ `
#ifdef USE_LIGHTMAP
if ( uProbe > 0.5 ) gl_FragColor = vec4( sqrt( clamp( lsBakedLight / 10.0, 0.0, 1.0 ) ), 1.0 );
#endif
`;

// Plain surfaces share one material. Which kind a face is (paint, brass, water, lamp) is the swatch
// column its uv points at.
const PLAIN_NORMAL = /* glsl */ `
float lsCell = floor( vRoughnessMapUv.x * LS_CELLS );
#ifdef LS_WATER
if ( abs( lsCell - LS_WATER ) < 0.5 ) {
  // Still water is a mirror, and a mirror gives a pool away. A slow ripple breaks the sky up.
  vec3 lsW = cameraPosition + ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz;
  float lsT = uSway > 0.0 ? uTime : 0.0;
  vec2 lsG = vec2(
    cos( lsW.x * 3.1 + lsT * 1.3 ) * 0.5 + cos( lsW.x * 7.3 - lsW.z * 2.1 + lsT * 2.1 ) * 0.3,
    cos( lsW.z * 2.7 - lsT * 1.1 ) * 0.5 + cos( lsW.z * 6.1 + lsW.x * 3.3 + lsT * 1.7 ) * 0.3 );
  float lsFlat = smoothstep( 0.8, 0.95, abs( ( vec4( normal, 0.0 ) * viewMatrix ).y ) );
  vec3 lsN = normalize( ( viewMatrix * vec4( - lsG.x * 0.07, 1.0, - lsG.y * 0.07, 0.0 ) ).xyz );
  normal = normalize( mix( normal, lsN * sign( dot( lsN, normal ) + 1e-4 ), lsFlat ) );
}
#endif
`;

// Paint, the same rule as the things that move: a strong poster colour is a dark pigment. Bright and
// pure at once does not exist in paint, and under the filmic curve in a low sun it comes out pale:
// the orange hydrant went salmon, the yellow sign at the Mask Garden cream. The pipeline pulls every
// plain colour to 0.8 of the drawn one. Pure colours go on down toward 0.5 here, pale ones stay.
// Metal keeps its colour, and so do the lamps, which make their own light.
const PLAIN_PULL = /* glsl */ `
float lsPunchK = 0.0;
{
  vec3 lsC = diffuseColor.rgb;
  float lsHi = max( lsC.r, max( lsC.g, lsC.b ) );
  float lsSat = ( lsHi - min( lsC.r, min( lsC.g, lsC.b ) ) ) / max( lsHi, 1e-4 );
  lsPunchK = lsSat * ( 1.0 - metalnessFactor );
#ifdef LS_LAMP
  if ( abs( lsCell - LS_LAMP ) < 0.5 ) lsPunchK = 0.0;
#endif
  diffuseColor.rgb *= mix( 1.0, 0.625, lsPunchK );
}
`;

// And the curve's own inset greys a strong colour before it bends it, so for paint I take that
// share back out first, as for the things that move. Greys pass through unchanged.
const PLAIN_PUNCH = /* glsl */ `
gl_FragColor.rgb = mix( gl_FragColor.rgb, max( mat3( 1.2542, - 0.1282, - 0.0984, - 0.2560, 1.2898, - 0.1639, 0.0020, - 0.1618, 1.2622 ) * gl_FragColor.rgb, 0.0 ), lsPunchK );
`;

// The low sun is orange, and on a strong paint colour it turns the hue: the orange hydrant went
// coral. As for the things that move, half of the light's own colour comes back out on pure paint,
// the way an eye adjusts to it. Pale paint and stone keep the warm light.
const PLAIN_SUN_KEEP = /* glsl */ `
  lightMapIrradiance = mix( lightMapIrradiance, vec3( dot( lightMapIrradiance, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.5 * lsPunchK );
`;

const PLAIN_EMISSIVE = /* glsl */ `
#ifdef LS_LAMP
if ( abs( lsCell - LS_LAMP ) < 0.5 ) totalEmissiveRadiance += vColor.rgb * uLamp;
#endif
`;

// Leaves do not stand still in a photograph. The cards shiver a few centimetres, each to its own beat.
const CARDS_PROJECT = /* glsl */ `
vec4 lsWorld = modelMatrix * vec4( transformed, 1.0 );
{
  float lsPh = lsWorld.x * 1.7 + lsWorld.z * 1.3 + lsWorld.y * 2.1;
  float lsA = sin( uTime * 1.9 + lsPh ) + 0.5 * sin( uTime * 3.7 + lsPh * 1.6 );
  float lsB = cos( uTime * 1.5 + lsPh * 1.2 );
  lsWorld.xyz += uSway * 0.035 * vec3( lsA, lsB * 0.5, lsB );
}
vec4 mvPosition = viewMatrix * lsWorld;
gl_Position = projectionMatrix * mvPosition;
`;

type Kind = 'baked' | 'plain' | 'cards' | 'standin';
type StandKind = 'solid' | 'cloud';

/** A standard material carries shader defines (it starts with STANDARD). The typings leave the field out. */
function addDefines(material: THREE.MeshStandardMaterial, more: Record<string, string>): void {
  const m = material as THREE.MeshStandardMaterial & { defines?: Record<string, string> };
  m.defines = { ...(m.defines ?? {}), ...more };
}

function patch(material: THREE.MeshStandardMaterial, kind: Kind, u: SharedUniforms, exposure?: Exposure, stand: StandKind = 'solid'): void {
  material.onBeforeCompile = (shader) => {
    const su = shader.uniforms as Record<string, THREE.IUniform>;
    su.uHaze = u.uHaze;
    su.uHazeSun = u.uHazeSun;
    su.uHazeToward = u.uHazeToward;
    su.uHazeAway = u.uHazeAway;
    su.uTime = u.uTime;
    su.uSway = u.uSway;
    let vs = shader.vertexShader;
    let fs = shader.fragmentShader;
    fs = fs.replace('#include <fog_fragment>', kind === 'standin' ? STANDIN_PUNCH + HAZE : HAZE + BAKED_PROBE);
    if (kind === 'standin') {
      const ex = exposure ?? openAir();
      su.uAtlas = u.uAtlas;
      su.uAtlasSize = u.uAtlasSize;
      su.uGlow = u.uGlow;
      su.uSunVis = ex.uSunVis;
      su.uAmb = ex.uAmb;
      su.uSunDir = u.uSunDir;
      su.uSunE = u.uSunE;
      su.uSkyUp = u.uSkyUp;
      su.uSkyDown = u.uSkyDown;
      su.uSunKeep = u.uSunKeep;
      vs = vs.replace('#include <common>', '#include <common>\n' + STANDIN_VERT_PARS).replace('#include <project_vertex>', STANDIN_PROJECT);
      fs = fs
        .replace('#include <common>', '#include <common>\n' + HAZE_PARS + STANDIN_FRAG_PARS)
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + STANDIN_COLOR)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + STANDIN_EMISSIVE)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n' + STANDIN_EXPOSURE);
    } else {
      su.uSkyUp = u.uSkyUp;
      su.uSkyDown = u.uSkyDown;
      su.uLamp = u.uLamp;
      su.uProbe = u.uProbe;
      su.uSunDir = u.uSunDir;
      su.uSunE = u.uSunE;
      su.uShine = u.uShine;
      su.uAo = u.uAo;
      fs = fs
        .replace('#include <common>', '#include <common>\n' + HAZE_PARS + BAKED_PARS)
        .replace('#include <lights_fragment_begin>', BAKED_LIGHTS_BEGIN)
        .replace('#include <lights_fragment_maps>', BAKED_LIGHTS_MAPS);
      if (kind === 'plain') {
        fs = fs
          .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + PLAIN_NORMAL + PLAIN_PULL)
          .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + PLAIN_EMISSIVE)
          .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + PLAIN_PUNCH)
          .replace('  irradiance += lightMapIrradiance;', PLAIN_SUN_KEEP + '  irradiance += lightMapIrradiance;');
      }
      if (kind === 'cards') {
        vs = vs.replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSway;').replace('#include <project_vertex>', CARDS_PROJECT);
      }
    }
    shader.vertexShader = vs;
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => 'ls-' + kind + '-' + stand;
}

// ---------------------------------------------------------------------------------------------
// Baked materials, from the manifest
// ---------------------------------------------------------------------------------------------

export interface BakedInputs {
  manifest: Manifest;
  u: SharedUniforms;
  sky: THREE.Texture;
  /** Library textures by file path, already loaded. */
  textures: Map<string, THREE.Texture>;
  half: boolean;
  /** The picture is drawn with several samples a pixel, so cut-outs can use them for a soft edge. */
  coverage: boolean;
}

/** File paths of the shared textures a material needs, for this size of set. */
/** What a shared texture is for. Decides the flat picture that stands in for it when its file cannot be had. */
export type TextureRole = 'color' | 'normal' | 'orm' | 'swatch' | 'atlas';
export interface TextureWant {
  file: string;
  srgb: boolean;
  repeat: boolean;
  nearest: boolean;
  role: TextureRole;
}

export function texturesOf(manifest: Manifest, name: string, half: boolean): TextureWant[] {
  const m = manifest.materials[name] as ManifestMaterial | undefined;
  if (!m) return [];
  const out: TextureWant[] = [];
  const pick = (f: { file: string; half?: string }): string => (half && f.half ? f.half : f.file);
  if (m.kind === 'plain' && m.swatch) out.push({ file: m.swatch, srgb: false, repeat: false, nearest: true, role: 'swatch' });
  if (m.kind === 'lettering') out.push({ file: pick(manifest.lettering), srgb: false, repeat: false, nearest: false, role: 'atlas' });
  const set = m.texture ? manifest.textures[m.texture] : null;
  if (set?.color) out.push({ file: pick(set.color), srgb: true, repeat: true, nearest: false, role: 'color' });
  if (set?.normal) out.push({ file: pick(set.normal), srgb: false, repeat: true, nearest: false, role: 'normal' });
  if (set?.orm) out.push({ file: pick(set.orm), srgb: false, repeat: true, nearest: false, role: 'orm' });
  return out;
}

/** One baked material: the manifest entry `name`, lit by `lightMap`. The recipe is docs/REAL.md, "Drawing it". */
export function bakedMaterial(name: string, lightMap: THREE.Texture | null, inp: BakedInputs): THREE.MeshStandardMaterial {
  const { manifest, u, textures, half } = inp;
  const m = manifest.materials[name] ?? ({ kind: 'plain' } as ManifestMaterial);
  const pick = (f: { file: string; half?: string }): THREE.Texture | null => textures.get(half && f.half ? f.half : f.file) ?? null;
  const mat = new THREE.MeshStandardMaterial({
    name,
    vertexColors: true,
    side: THREE.DoubleSide,
    lightMap,
    lightMapIntensity: manifest.look.lightMapIntensity,
    roughness: m.roughness ?? 1,
    metalness: m.metalness ?? 0,
  });
  let kind: Kind = 'baked';
  if (m.kind === 'plain') {
    kind = 'plain';
    const swatch = m.swatch ? (textures.get(m.swatch) ?? null) : null;
    if (swatch) {
      mat.roughnessMap = mat.metalnessMap = swatch;
      mat.roughness = 1;
      mat.metalness = 1;
      const cells = m.cells ?? [];
      const defines: Record<string, string> = { LS_CELLS: cells.length.toFixed(1) };
      if (cells.includes('water')) defines.LS_WATER = cells.indexOf('water').toFixed(1);
      if (cells.includes('lamp')) defines.LS_LAMP = cells.indexOf('lamp').toFixed(1);
      addDefines(mat, defines);
    } else kind = 'baked';
  } else if (m.kind === 'glass') {
    mat.transparent = true;
    mat.opacity = m.opacity ?? 0.4;
    mat.depthWrite = false;
    // three.js draws a see-through two sided mesh twice, backs then fronts. A pane does not need that,
    // and the manifest counts one draw call a primitive.
    mat.forceSinglePass = true;
  } else if (m.kind === 'lettering') {
    mat.alphaMap = pick(manifest.lettering);
    mat.transparent = true;
    mat.depthWrite = false;
    mat.forceSinglePass = true;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
    mat.polygonOffsetUnits = -2;
    mat.roughness = m.roughness ?? 0.8;
  } else {
    const set = m.texture ? manifest.textures[m.texture] : null;
    if (set?.color) mat.map = pick(set.color);
    if (set?.normal) {
      mat.normalMap = pick(set.normal);
      // uv runs top down in these files, so the green channel of the normal map flips with it.
      const s = m.normalScale ?? 1;
      mat.normalScale.set(s, -s);
    }
    if (set?.orm) {
      mat.roughnessMap = mat.metalnessMap = pick(set.orm);
      mat.roughness = 1;
      mat.metalness = 1;
      // The red channel of the same picture is occlusion. See BAKED_LIGHTS_MAPS.
      if (mat.roughnessMap) addDefines(mat, { LS_AO: '' });
    }
    if (m.kind === 'cards') {
      kind = 'cards';
      mat.alphaTest = m.alphaTest ?? 0.5;
      mat.alphaToCoverage = inp.coverage;
    }
  }
  // The sky goes on the material itself: three ignores envMapIntensity for scene.environment.
  mat.envMap = inp.sky;
  mat.envMapIntensity = m.reflect ?? 1;
  patch(mat, kind, u);
  return mat;
}

// ---------------------------------------------------------------------------------------------
// The stand-in: ink geometry, drawn as a built thing
// ---------------------------------------------------------------------------------------------

const STANDIN_VERT_PARS = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aData;
attribute vec4 aInk;
uniform float uTime;
uniform float uSway;
varying vec3 vLsColor;
varying vec4 vLsParams;
varying vec3 vLsInk;
varying vec2 vLsUv;
vec3 lsToLinear( vec3 c ) {
  return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
}
`;

// The ink material's own sway, to the letter, so a flag moves the same in both looks.
const STANDIN_PROJECT = /* glsl */ `
mat4 lsM = modelMatrix;
#ifdef USE_INSTANCING
  lsM = modelMatrix * instanceMatrix;
#endif
vec4 lsWorld = lsM * vec4( transformed, 1.0 );
if ( aData.w > 0.0 ) {
  float lsPh = lsM[ 3 ].x * 0.37 + lsM[ 3 ].z * 0.23 + position.x * 0.31 + position.z * 0.27;
  float lsA = sin( uTime * 1.35 + lsPh ) + 0.45 * sin( uTime * 2.9 + lsPh * 1.7 );
  float lsB = cos( uTime * 1.1 + lsPh * 1.3 );
  lsWorld.xz += aData.w * uSway * vec2( lsA, lsB * 0.6 );
}
vec4 mvPosition = viewMatrix * lsWorld;
gl_Position = projectionMatrix * mvPosition;
vLsColor = lsToLinear( aColor.rgb );
vLsParams = vec4( aColor.a, aData.y, aData.z, aInk.a );
vLsInk = lsToLinear( aInk.rgb );
vLsUv = uv;
`;

const STANDIN_FRAG_PARS = /* glsl */ `
// How much the albedo of this fragment was pulled down from the drawn colour. Glow is measured against the drawn colour.
float lsAlbK = LS_ALBEDO;
uniform sampler2D uAtlas;
uniform float uAtlasSize;
uniform float uGlow;
uniform vec4 uSunVis;
uniform float uAmb;
uniform vec3 uSunDir;
uniform vec3 uSunE;
uniform vec3 uSkyUp;
uniform vec3 uSkyDown;
uniform vec3 uSunKeep;
varying vec3 vLsColor;
varying vec4 vLsParams;
varying vec3 vLsInk;
varying vec2 vLsUv;
`;

const STANDIN_COLOR = /* glsl */ `
{
  // What the drawing dithers (glass, a cloud floor), this look thins with a fine grain, steady on the screen.
  float lsN = fract( 52.9829189 * fract( dot( gl_FragCoord.xy, vec2( 0.06711056, 0.00583715 ) ) ) );
  // With several samples a pixel, thinness goes out as coverage and the grain all but disappears.
  float lsThin = vLsParams.z < 0.995 ? vLsParams.z : 1.0;
#ifdef LS_CLOUD
  // A cloud has no edge. Where the drawn shape turns away from the eye it thins out to nothing.
  float lsFacing = abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) );
  lsThin *= smoothstep( 0.04, 0.62, lsFacing );
#endif
  if ( lsThin < 0.995 ) {
  #ifdef ALPHA_TO_COVERAGE
    diffuseColor.a = clamp( lsThin + ( lsN - 0.5 ) * 0.3, 0.0, 1.0 );
    if ( diffuseColor.a <= 0.0 ) discard;
  #else
    if ( lsN >= lsThin ) discard;
  #endif
  }
  // Lettering, read from the ink look's own atlas. Sampled for every fragment so the derivatives are defined.
  float lsA = texture2D( uAtlas, vLsUv ).r;
  vec3 lsPaint = vLsColor;
#ifdef LS_PUNCH
  // A strong poster colour is a dark pigment. Bright and pure at once does not exist in paint: under
  // the filmic curve it comes out pale, an orange jacket goes peach. Pale colours keep the paint
  // pull of 0.8, pure ones go down to 0.5. And a soft colour (the sage of the hero mask, the
  // whale's lilac) gets a little more of its own colour, so warm low light does not wash it out.
  {
    float lsHi = max( vLsColor.r, max( vLsColor.g, vLsColor.b ) );
    float lsLo = min( vLsColor.r, min( vLsColor.g, vLsColor.b ) );
    float lsSat = ( lsHi - lsLo ) / max( lsHi, 1e-4 );
    float lsLum = dot( vLsColor, vec3( 0.2126, 0.7152, 0.0722 ) );
    lsPaint = max( vec3( lsLum ) + ( vLsColor - lsLum ) * mix( 1.5, 1.0, lsSat * lsSat ), 0.0 );
    lsAlbK = mix( LS_ALBEDO, 0.5, lsSat );
  }
#endif
  vec3 lsBase = lsPaint * lsAlbK;
  float lsMode = vLsParams.w;
  if ( lsMode > 0.25 ) {
    float lsSharp = clamp( ( lsA - 0.5 ) / clamp( fwidth( lsA ), 0.02, 1.0 ) + 0.5, 0.0, 1.0 );
    float lsTpp = length( fwidth( vLsUv ) ) * uAtlasSize * 0.7071;
    float lsCov = mix( lsSharp, clamp( lsA * 1.9, 0.0, 1.0 ), smoothstep( 0.75, 1.8, lsTpp ) );
    if ( lsMode > 0.75 ) {
      if ( lsCov < 0.5 ) discard;
      lsCov = 1.0;
    } else if ( lsCov < 0.02 ) discard;
    lsBase = mix( lsBase, vLsInk, lsCov );
  }
  diffuseColor.rgb *= lsBase;
}
`;

// On a thing that moves, a part the drawing paints flat is one that makes its own light: a flame, a
// lantern, a marker. On a building that is only waiting for its baked version, flat parts are mostly
// paint: signs, inlays, the drawn shadows on the ground. Those take the light like anything else.
const STANDIN_EMISSIVE = /* glsl */ `
#ifndef LS_NO_GLOW
totalEmissiveRadiance += diffuseColor.rgb * ( uGlow * LS_ALBEDO / lsAlbK ) * smoothstep( 0.62, 1.0, vLsParams.x );
#endif
`;

// Things that move are the drawing's own colours, and they have to stay those colours. The output's
// AgX curve starts by mixing a share of each channel into the others (its inset), which turns a
// strong colour pale before the curve even bends it. For these things alone I mix that share back
// out first: the inverse of the inset, taken in the curve's own Rec. 2020 space and brought back to
// linear sRGB. Greys pass through it unchanged.
const STANDIN_PUNCH = /* glsl */ `
#ifdef LS_PUNCH
gl_FragColor.rgb = max( mat3( 1.2542, - 0.1282, - 0.0984, - 0.2560, 1.2898, - 0.1639, 0.0020, - 0.1618, 1.2622 ) * gl_FragColor.rgb, 0.0 );
#endif
`;

// The sun lamp knows nothing of the buildings. What reaches the figure is read off the baked ground
// under him (see "The light on the figure" in index.ts) and applied here: the sun by height, the sky as a whole.
const STANDIN_EXPOSURE = /* glsl */ `
{
  float lsY = ( cameraPosition + ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz ).y;
  float lsVis = mix( uSunVis.x, uSunVis.y, smoothstep( uSunVis.z, uSunVis.w, lsY ) );
  reflectedLight.directDiffuse *= lsVis;
  reflectedLight.directSpecular *= lsVis;
  reflectedLight.indirectDiffuse *= uAmb;
#ifdef LS_PUNCH
  // A painted thing, cloth, a balloon: the low sun's sheen off a rough face is most of what made
  // them read as plastic and turned their colour pale. Keep a little of it. And the low sun is
  // orange: on the drawing's own colours it turned the whale pink and the mask olive. Half of its
  // colour comes back out, the way an eye adjusts to it.
  reflectedLight.directDiffuse *= uSunKeep;
  reflectedLight.directSpecular *= 0.3;
  reflectedLight.indirectSpecular *= 0.6;
#endif
}
#ifdef LS_CLOUD
{
  // A cloud is not a lump with a lit side and a dark side. Light goes into it and comes out
  // everywhere: the sun side is bright, the far side is the sky's blue grey, never black, and with
  // the sun behind it the rim glows.
  vec3 lsN = normalize( vNormal );
  vec3 lsL = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
  vec3 lsV = normalize( vViewPosition );
  float lsWrap = dot( lsN, lsL ) * 0.5 + 0.5;
  float lsBack = pow( max( dot( - lsV, lsL ), 0.0 ), 5.0 );
  float lsUpW = ( vec4( lsN, 0.0 ) * viewMatrix ).y * 0.5 + 0.5;
  vec3 lsAlb = diffuseColor.rgb * RECIPROCAL_PI;
  reflectedLight.directDiffuse = lsAlb * uSunE * ( 0.08 + 0.5 * lsWrap * lsWrap + 0.6 * lsBack );
  reflectedLight.indirectDiffuse = lsAlb * mix( uSkyDown, uSkyUp, lsUpW ) * 1.15;
  reflectedLight.directSpecular = vec3( 0.0 );
  reflectedLight.indirectSpecular = vec3( 0.0 );
}
#endif
`;

export interface StandIns {
  /** For plain meshes and for instanced ones. Two objects, so three never has to swap programs on one. */
  plain: THREE.MeshStandardMaterial;
  instanced: THREE.MeshStandardMaterial;
  /** The same pair for geometry that stands still and is waiting for its baked version: nothing on it glows. */
  waiting: THREE.MeshStandardMaterial;
  waitingInstanced: THREE.MeshStandardMaterial;
  /** The figure: the same material, with the light measured where he stands. */
  figure: THREE.MeshStandardMaterial;
  figureLight: Exposure;
  /** Clouds: soft at the edge. */
  cloud: THREE.MeshStandardMaterial;
  /** The drawn blob under the figure, as a soft dark patch: where his feet meet the ground. */
  patch: THREE.ShaderMaterial;
  /** The picture gained or lost its extra samples a pixel: thin parts go out as coverage or as grain. */
  setCoverage(on: boolean): void;
  dispose(): void;
}

export function standIns(u: SharedUniforms, sky: THREE.Texture, coverage: boolean): StandIns {
  const make = (name: string, exposure?: Exposure, stand: StandKind = 'solid', glow = true): THREE.MeshStandardMaterial => {
    const m = new THREE.MeshStandardMaterial({ name, side: THREE.DoubleSide, roughness: 0.72, metalness: 0, envMap: sky, envMapIntensity: 0.3 });
    // Poster colours are brighter than paint. The pipeline pulls plain colours down by the same amount.
    // What moves keeps its colour (LS_PUNCH) and takes half the haze: the hero mask, the whale and
    // the wheels are landmarks, and they stand far off. Geometry only waiting for its bake is drawn
    // the way the bake will draw it.
    const live = { LS_ALBEDO: '0.8', LS_PUNCH: '', LS_HAZE_K: '0.5' };
    addDefines(m, stand === 'cloud' ? { LS_ALBEDO: '0.95', LS_CLOUD: '' } : glow ? live : { LS_ALBEDO: '0.8', LS_NO_GLOW: '' });
    if (stand === 'cloud') {
      m.roughness = 1;
      m.envMapIntensity = 0;
    }
    m.alphaToCoverage = coverage;
    patch(m, 'standin', u, exposure, stand);
    return m;
  };
  const plain = make('stand-in');
  const instanced = make('stand-in-instanced');
  const waiting = make('stand-in-waiting', undefined, 'solid', false);
  const waitingInstanced = make('stand-in-waiting-instanced', undefined, 'solid', false);
  const figureLight = openAir();
  const figure = make('stand-in-figure', figureLight);
  const cloud = make('stand-in-cloud', undefined, 'cloud');
  // The blob is a disc of 0.43 m about the mesh's own origin. Darkest under him, gone at the rim.
  const dark = new THREE.ShaderMaterial({
    name: 'stand-in-patch',
    uniforms: { uOpacity: { value: 0.4 } },
    vertexShader: 'varying vec3 vP;\nvoid main() {\n  vP = position;\n  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );\n}',
    fragmentShader:
      'uniform float uOpacity;\nvarying vec3 vP;\nvoid main() {\n  float a = 1.0 - smoothstep( 0.12, 1.0, length( vP ) / 0.43 );\n  gl_FragColor = vec4( vec3( 0.0 ), a * a * uOpacity );\n}',
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  dark.toneMapped = false;
  return {
    plain,
    instanced,
    waiting,
    waitingInstanced,
    figure,
    figureLight,
    cloud,
    patch: dark,
    setCoverage(on) {
      for (const m of [plain, instanced, waiting, waitingInstanced, figure, cloud]) {
        if (m.alphaToCoverage === on) continue;
        m.alphaToCoverage = on;
        m.needsUpdate = true;
      }
    },
    dispose() {
      plain.dispose();
      instanced.dispose();
      waiting.dispose();
      waitingInstanced.dispose();
      figure.dispose();
      cloud.dispose();
      dark.dispose();
    },
  };
}
