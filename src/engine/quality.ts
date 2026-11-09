// Quality tiers and adaptive resolution.
//
// The tier decides the expensive, slow-to-change things (how much scatter, how many clouds). The pixel
// ratio is the fast lever: it moves in small steps while the visitor walks, and the tier only drops
// once resolution has nothing left to give. The tier never climbs back on its own, because a tier
// change rebuilds things and a world that keeps rebuilding is worse than one that stays a bit plain.
//
// Frame times come from requestAnimationFrame, so they are quantised to the display: a 60 Hz screen
// reports 16.7 ms however little work there was. That is why "there is headroom" is judged against the
// steady rhythm of the display rather than against a fixed number, and why stepping up is a guess that
// backs off when it turns out wrong.
import type { QualityTier } from '../types';

export interface Quality {
  tier: QualityTier;
  /** What to hand to renderer.setPixelRatio. */
  pixelRatio: number;
  /** True while the tier and resolution look after themselves. False when a tier has been pinned. */
  auto: boolean;
  /** Smoothed frame time in milliseconds, for the debug readout. */
  frameMs: number;
  /** Feed every frame. Returns true when tier or pixelRatio changed during this call. */
  frame(dtSeconds: number): boolean;
  /** Pin a tier (resolution stops adapting too), or hand control back with 'auto'. */
  setTier(tier: QualityTier | 'auto'): void;
  /** Called after any change to tier, pixelRatio or auto. Returns a function that removes the listener. */
  onChange(cb: (q: Quality) => void): () => void;
}

type AnyGL = WebGLRenderingContext | WebGL2RenderingContext;

/** Never render below this fraction of a CSS pixel. Under it the ink line turns to mush. */
export const MIN_PIXEL_RATIO = 0.6;

const TIER_CAP: Record<QualityTier, number> = { low: 1, medium: 1.5, high: 2 };

// Rough ceiling on pixels drawn at start-up, so a 4K window does not open on a slideshow.
const TIER_START_PIXELS: Record<QualityTier, number> = { low: 1.3e6, medium: 2.6e6, high: 5.2e6 };

const WARMUP = 1.0; // seconds of frames to ignore after load
const HITCH = 0.25; // a frame longer than this is a tab switch, not a slow machine
const SLOW_HOLD = 1.0; // seconds over the slow line before resolution steps down
const FAST_HOLD = 3.0; // seconds under the fast line before it steps back up
const FLOOR_HOLD = 2.5; // seconds slow at the floor before the tier drops
const STEP_DOWN = 0.85;
const STEP_UP = 1.12;
const SETTLE = 0.5; // seconds to look away after a change, while buffers resize
const TIER_SETTLE = 2.0;
const RETRY_FIRST = 20; // seconds before retrying a resolution that was too slow
const RETRY_MAX = 240;
const PROBE_SETTLE = 0.4;
const PROBE_MEASURE = 0.8;
const PROBE_AGAIN = 60;

/** The highest pixel ratio a tier will use on this screen. */
export function pixelRatioCap(tier: QualityTier): number {
  const dpr = typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  return Math.max(MIN_PIXEL_RATIO, Math.min(dpr, TIER_CAP[tier]));
}

function parseTier(value: string | null | undefined): QualityTier | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

/** The ?q= switch, or null. */
function tierFromUrl(): QualityTier | null {
  if (typeof location === 'undefined') return null;
  try {
    return parseTier(new URLSearchParams(location.search).get('q'));
  } catch {
    return null;
  }
}

function rendererString(gl: AnyGL | null | undefined): string {
  if (!gl) return '';
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    return typeof name === 'string' ? name : '';
  } catch {
    return '';
  }
}

/** A starting tier from things that cost nothing to read. It only has to be roughly right:
 *  the adaptive loop corrects it within a few seconds of walking. Pass the WebGL context when
 *  there is one and the GPU name gets a vote. */
export function guessTier(gl?: AnyGL | null): QualityTier {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 'medium';
  const nav = navigator as Navigator & { deviceMemory?: number };
  const cores = nav.hardwareConcurrency || 0; // 0 when the browser will not say
  const memory = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 0;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const shortSide = Math.min(window.screen?.width || 0, window.screen?.height || 0);
  const gpu = rendererString(gl);

  // The GPU name is the best single signal when we have it.
  if (gpu) {
    if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)) return 'low';
    if (/mali-(4|t)|adreno \(tm\) [2-5]\d\d|adreno [2-5]\d\d|powervr sgx|powervr rogue g6|videocore|intel.*(hd graphics [2-5]\d{3}|gma|g4[15]|q4[35]|ironlake|sandybridge|ivybridge)/i.test(gpu)) {
      return 'low';
    }
  }
  if (memory > 0 && memory <= 2) return 'low';
  if (cores > 0 && cores <= 2) return 'low';
  if (cores > 0 && cores <= 4 && memory > 0 && memory <= 4) return 'low';

  if (coarse) {
    // Phones and tablets: plenty of pixels, not much heat budget. Medium, and let them prove more.
    // A small old phone with few cores goes low.
    if (shortSide > 0 && shortSide < 360 && cores > 0 && cores <= 4) return 'low';
    return 'medium';
  }

  if (gpu) {
    if (/apple m\d|rtx|gtx (1[06]\d\d|9[78]\d)|radeon (rx|pro)|geforce.*(20|30|40|50)\d\d|\barc\b|quadro/i.test(gpu)) return 'high';
    if (/intel|iris|uhd|mesa|radeon\(tm\) graphics|vega \d/i.test(gpu)) return 'medium';
  }
  if (cores >= 8 && (memory === 0 || memory >= 8)) return 'high';
  return 'medium';
}

/** Where the pixel ratio starts for a tier: the tier's cap, pulled down if the window is huge.
 *  It never starts below one device-independent pixel on that account. The adaptive loop can go
 *  lower once it has real frame times to go on. */
function startRatio(tier: QualityTier): number {
  const cap = pixelRatioCap(tier);
  if (typeof window === 'undefined') return cap;
  const css = Math.max(1, (window.innerWidth || 1280) * (window.innerHeight || 720));
  const fit = Math.sqrt(TIER_START_PIXELS[tier] / css); // the ratio that draws exactly the budget
  const least = Math.min(1, cap);
  return fit < least ? least : fit > cap ? cap : fit;
}

/**
 * @param initial  A tier to pin, or 'auto' (the default) to guess one and adapt.
 *                 A ?q=low|medium|high in the address bar wins over this argument.
 * @param gl       Optional. The WebGL context, so the GPU name can inform the first guess.
 */
export function createQuality(initial: QualityTier | 'auto' = 'auto', gl?: AnyGL | null): Quality {
  const listeners: Array<(q: Quality) => void> = [];
  const fromUrl = tierFromUrl();
  const first: QualityTier | 'auto' = fromUrl ?? initial;

  // Frame statistics. All plain numbers, nothing allocated after this point.
  let clock = 0; // seconds of frames fed
  let smoothed = 1 / 60;
  let base = 1 / 60; // the steady frame interval this display gives when all is well
  let slowFor = 0;
  let fastFor = 0;
  let floorFor = 0;
  let holdUntil = 0; // ignore the timers until the clock passes this
  let failedAt = Infinity; // a pixel ratio that turned out too slow
  let retryAt = 0; // do not climb back to failedAt before this
  let backoff = RETRY_FIRST;
  let lastUpAt = -1e9;
  let upFrom = 0; // the pixel ratio we stepped up from, known to be fine
  // One second windows, to tell a steady rhythm from a struggling one.
  let winTime = 0;
  let winCount = 0;
  let winSum = 0;
  let winSq = 0;
  let steadyMean = 0; // mean of the last window, 0 if there has not been one
  let steady = false; // was the last window even enough to be a display rhythm
  // The probe: see `startProbe`.
  let probing = 0; // 0 idle, 1 settling, 2 measuring
  let probeUntil = 0;
  let probeBefore = 0;
  let probeSaved = 0;
  let probeSum = 0;
  let probeCount = 0;
  let probeAllowedAt = 0;
  let pixelsMatter = false; // a probe has shown that resolution sets the pace, so no need to ask again

  function resetStats(): void {
    slowFor = 0;
    fastFor = 0;
    floorFor = 0;
    failedAt = Infinity;
    retryAt = 0;
    backoff = RETRY_FIRST;
    upFrom = 0;
    probing = 0;
    probeAllowedAt = 0;
    pixelsMatter = false;
    base = 1 / 60;
    clearWindow();
    steady = false;
    steadyMean = 0;
    holdUntil = clock + SETTLE;
  }

  function clearWindow(): void {
    winTime = 0;
    winCount = 0;
    winSum = 0;
    winSq = 0;
  }

  function emit(): void {
    for (let i = 0; i < listeners.length; i++) listeners[i]!(q);
  }

  function slowLine(): number {
    return Math.max(0.02, base * 1.22);
  }

  function fastLine(): number {
    return Math.max(0.012, base * 1.07);
  }

  function closeWindow(): void {
    const mean = winSum / winCount;
    const variance = Math.max(0, winSq / winCount - mean * mean);
    steady = Math.sqrt(variance) < mean * 0.06;
    steadyMean = mean;
    // An even rhythm at 48 Hz or better is the display talking. A 60 Hz screen under load gives a mix
    // of 16.7 and 33.3, which is never even, so this cannot mistake a slow machine for a slow screen.
    if (steady && mean <= 0.021 && mean >= 0.004) base = mean;
    clearWindow();
  }

  // A rock-steady 30 frames a second can mean two opposite things: a phone in low power mode whose
  // browser caps the frame rate, or a slow GPU on a 60 Hz screen that just misses every other refresh.
  // Lowering resolution helps the second and only blurs the first. So ask the question directly:
  // drop to the floor for a second and see whether the frame time moves.
  function startProbe(): void {
    probing = 1;
    probeBefore = steadyMean;
    probeSaved = q.pixelRatio;
    probeUntil = clock + PROBE_SETTLE;
    probeSum = 0;
    probeCount = 0;
    clearWindow();
    q.pixelRatio = MIN_PIXEL_RATIO;
  }

  function finishProbe(): void {
    probing = 0;
    probeAllowedAt = clock + PROBE_AGAIN;
    slowFor = 0;
    fastFor = 0;
    floorFor = 0;
    holdUntil = clock + SETTLE;
    const after = probeCount > 0 ? probeSum / probeCount : probeBefore;
    if (after > probeBefore * 0.93) {
      if (after <= 0.036) {
        // Resolution is not what sets the pace and the pace is bearable. Call it the display's rhythm
        // and put the sharpness back.
        base = after;
        q.pixelRatio = probeSaved;
        smoothed = after;
      }
      // Slower than that and unmoved by resolution: stay at the floor and let the tier drop.
      return;
    }
    // It moved, so pixels are the cost. Come back up to a little under halfway (in pixel count)
    // between the floor and where we were, and let the ordinary steps find the level from there.
    pixelsMatter = true;
    failedAt = probeSaved;
    retryAt = clock + backoff;
    q.pixelRatio = Math.max(MIN_PIXEL_RATIO, Math.sqrt((MIN_PIXEL_RATIO * MIN_PIXEL_RATIO + probeSaved * probeSaved) / 2) * STEP_DOWN);
  }

  function adapt(dt: number): void {
    const cap = pixelRatioCap(q.tier);

    if (probing !== 0) {
      if (probing === 1) {
        if (clock >= probeUntil) {
          probing = 2;
          probeUntil = clock + PROBE_MEASURE;
        }
      } else {
        probeSum += dt;
        probeCount++;
        if (clock >= probeUntil) finishProbe();
      }
      return;
    }

    if (clock < holdUntil) return;

    const slow = smoothed > slowLine();
    const fast = smoothed < fastLine();
    slowFor = slow ? slowFor + dt : 0;
    fastFor = fast ? fastFor + dt : 0;

    if (slowFor >= SLOW_HOLD) {
      if (q.pixelRatio > MIN_PIXEL_RATIO + 0.005) {
        floorFor = 0;
        if (!pixelsMatter && steady && steadyMean > base * 1.7 && clock >= probeAllowedAt) {
          startProbe();
          return;
        }
        failedAt = q.pixelRatio;
        if (clock - lastUpAt < 12 && upFrom > 0 && upFrom < q.pixelRatio) {
          // The step up we just tried is what broke it. Go back to exactly where it was fine,
          // and wait twice as long before trying that step again.
          backoff = Math.min(RETRY_MAX, backoff * 2);
          q.pixelRatio = upFrom;
        } else {
          q.pixelRatio = Math.max(MIN_PIXEL_RATIO, q.pixelRatio * STEP_DOWN);
        }
        upFrom = 0;
        retryAt = clock + backoff;
        slowFor = 0;
        fastFor = 0;
        holdUntil = clock + SETTLE;
      } else {
        // Resolution has bottomed out. Only now is the tier allowed to give.
        floorFor += dt;
        if (floorFor >= FLOOR_HOLD) {
          if (q.tier !== 'low') {
            q.tier = q.tier === 'high' ? 'medium' : 'low';
            floorFor = 0;
            slowFor = 0;
            fastFor = 0;
            failedAt = Infinity;
            backoff = RETRY_FIRST;
            holdUntil = clock + TIER_SETTLE;
          } else if (steady && steadyMean <= 0.036) {
            // Nothing left to give and the machine holds an even 30. Take that as its rhythm, so
            // resolution can climb again for as long as the rhythm survives.
            base = steadyMean;
            floorFor = 0;
            slowFor = 0;
          }
        }
      }
      return;
    }
    if (!slow) floorFor = 0;

    if (fastFor >= FAST_HOLD && q.pixelRatio < cap - 0.005) {
      let next = Math.min(cap, q.pixelRatio * STEP_UP);
      if (cap - next < 0.04) next = cap;
      if (next >= failedAt - 0.005) {
        if (clock < retryAt) {
          // Not yet. Keep the timer topped up so the retry happens as soon as it is allowed.
          fastFor = FAST_HOLD;
          return;
        }
        failedAt = Infinity;
      }
      upFrom = q.pixelRatio;
      q.pixelRatio = next;
      lastUpAt = clock;
      fastFor = 0;
      slowFor = 0;
      holdUntil = clock + SETTLE;
    } else if (clock - lastUpAt > 30 && failedAt === Infinity) {
      // A step up that has held for a while earns back the short retry delay.
      backoff = RETRY_FIRST;
    }
  }

  const q: Quality = {
    tier: 'medium',
    pixelRatio: 1,
    auto: true,
    frameMs: 1000 / 60,

    frame(dtSeconds: number): boolean {
      const tier0 = q.tier;
      const ratio0 = q.pixelRatio;

      // Browser zoom or a move to another monitor changes the ceiling under us.
      const cap = pixelRatioCap(q.tier);
      if (!q.auto) {
        if (q.pixelRatio !== cap) q.pixelRatio = cap;
      } else if (q.pixelRatio > cap) {
        q.pixelRatio = cap;
      }

      if (dtSeconds > 0 && dtSeconds <= HITCH) {
        clock += dtSeconds;
        if (clock > WARMUP) {
          smoothed += (dtSeconds - smoothed) * (1 - Math.exp(-dtSeconds / 0.3));
          q.frameMs = smoothed * 1000;
          if (q.auto) {
            if (probing === 0) {
              winTime += dtSeconds;
              winCount++;
              winSum += dtSeconds;
              winSq += dtSeconds * dtSeconds;
              if (winTime >= 1 && winCount >= 8) closeWindow();
            }
            adapt(dtSeconds);
          }
        }
      } else if (dtSeconds > HITCH) {
        // Coming back from a hidden tab. Forget the half-built evidence and look away for a moment.
        slowFor = 0;
        fastFor = 0;
        clearWindow();
        if (holdUntil < clock + SETTLE) holdUntil = clock + SETTLE;
        if (probing !== 0) {
          probing = 0;
          q.pixelRatio = Math.min(probeSaved, cap);
        }
      }

      const changed = q.tier !== tier0 || q.pixelRatio !== ratio0;
      if (changed) emit();
      return changed;
    },

    setTier(tier: QualityTier | 'auto'): void {
      const tier0 = q.tier;
      const ratio0 = q.pixelRatio;
      const auto0 = q.auto;
      if (tier === 'auto') {
        q.auto = true;
        q.tier = guessTier(gl);
        q.pixelRatio = startRatio(q.tier);
      } else {
        const pinned = parseTier(tier);
        if (!pinned) return;
        q.auto = false;
        q.tier = pinned;
        q.pixelRatio = pixelRatioCap(pinned);
      }
      resetStats();
      if (q.tier !== tier0 || q.pixelRatio !== ratio0 || q.auto !== auto0) emit();
    },

    onChange(cb: (q: Quality) => void): () => void {
      listeners.push(cb);
      return () => {
        const i = listeners.indexOf(cb);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  };

  q.setTier(first);
  return q;
}
