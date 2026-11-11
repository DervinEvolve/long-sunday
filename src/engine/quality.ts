// Quality tiers and adaptive resolution.
//
// The tier decides the expensive things. How much scatter, how many clouds and how detailed each
// district is are fixed when the world is built, from the tier the page loaded with. A tier change
// after that rebuilds nothing: it changes the ink settings, the draw distance, the haze and how many
// triangles the picture may hold, and the full detail level applies from the next load. The pixel
// ratio is the fast lever: it moves in small steps while the visitor walks, and the tier only drops
// once resolution has nothing left to give. The tier never climbs back on its own: a picture that
// keeps changing its mind is worse than one that stays a bit plain.
//
// A tier chosen in the settings is a ceiling for the tier only. Resolution keeps adapting under it,
// so choosing Low can never make the picture heavier than Auto had it. A ?q= in the address pins
// both, so screenshots and measurements come out the same every time.
//
// Frame times come from requestAnimationFrame, so they are quantised to the display: a 60 Hz screen
// reports 16.7 ms however little work there was. That is why "there is headroom" is judged against the
// steady rhythm of the display rather than against a fixed number, and why stepping up is a guess that
// backs off when it turns out wrong.
//
// An even 30 that resolution does not move is either a capped browser or a device that is short of
// 60 by more than pixels. The tier below can tell them apart, so Auto tries it once: if it holds the
// display's rhythm it stays, smooth and a bit plainer beats sharp and juddering. If it does not, the
// tier goes back after five seconds and the 30 is taken as the rhythm.
import type { QualityTier } from '../types';

export interface Quality {
  tier: QualityTier;
  /** What to hand to renderer.setPixelRatio. */
  pixelRatio: number;
  /** True while the tier looks after itself. False when a tier has been pinned (resolution still adapts). */
  auto: boolean;
  /** Smoothed frame time in milliseconds, for the debug readout. */
  frameMs: number;
  /** Feed every frame. Returns true when tier or pixelRatio changed during this call. */
  frame(dtSeconds: number): boolean;
  /** Pin a tier (resolution carries on adapting under it), or hand the tier back with 'auto'. */
  setTier(tier: QualityTier | 'auto'): void;
  /** Called after any change to tier, pixelRatio or auto. Returns a function that removes the listener. */
  onChange(cb: (q: Quality) => void): () => void;
  /** The world has two looks and they cost very different amounts to draw, so what was learned in
   *  one says little about the other. Each look keeps its own tier and resolution. On a change of
   *  look the pair in use is put away under the old name, and the pair last used under the new name
   *  comes back. A look seen for the first time starts from where things stand. A tier the visitor
   *  pinned stays through both. */
  setLook(name: string): void;
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
const TRIAL_SETTLE = 2.0; // a trial of the tier below: seconds to let it settle
const TRIAL_MEASURE = 3.0; // then seconds to time it. The tier never comes back up sooner than these two.
const TRIAL_AGAIN = 300;

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

/** A starting tier from things that cost nothing to read. Geometry is built from this guess and
 *  the tier never climbs, so when in doubt it leans low. Pass the WebGL context when there is one
 *  and the GPU name gets a vote. */
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
    // The budget phone chips of the last few years. They report eight cores, so nothing below catches them.
    if (/mali-g(31|51|52|57)|powervr (rogue )?ge8|adreno \(tm\) 6[01]\d/i.test(gpu)) return 'low';
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
 *  lower once it has real frame times to go on.
 *  A phone or tablet starts at one: the first seconds are the title card and the first steps, and
 *  those should be the lightest the device sees. It climbs from there while frames stay on time. */
function startRatio(tier: QualityTier): number {
  const cap = pixelRatioCap(tier);
  if (typeof window === 'undefined') return cap;
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return Math.min(cap, 1);
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
  let tierPinned = false; // a tier was chosen: the governor may not drop it
  let booted = false;

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
  let pixelsIdle = false; // a probe has shown the opposite: slow, and resolution makes no difference
  let gaveUp = false; // the floor did not make it fast either, so the sharpness went back
  let descentFrom = 0; // the pixel ratio a run of steps down began at
  let descentMs = 0; // and the frame time there
  let trialFrom: QualityTier = 'medium'; // the tier a trial stepped down from
  let trialAllowedAt = 0;
  // What each look last ran at. See `setLook`.
  const looks = new Map<string, { tier: QualityTier; pixelRatio: number; auto: boolean }>();
  let lookName = 'ink';

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
    trialAllowedAt = 0;
    pixelsMatter = false;
    pixelsIdle = false;
    gaveUp = false;
    descentFrom = 0;
    descentMs = 0;
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
      // Resolution is not what sets the pace, so blur buys nothing: put the sharpness back either way.
      q.pixelRatio = probeSaved;
      if (after <= 0.036) {
        // A steady 30 or so. If the tier is still mine to move, see whether the one below makes 60.
        if (!tierPinned && q.tier !== 'low' && after > 0.024 && clock >= trialAllowedAt) {
          startTrial(after);
          return;
        }
        // Otherwise the pace is bearable. Call it the display's rhythm.
        base = after;
        smoothed = after;
      } else {
        // Slower than that. The tier is the only thing left to try, and it can go at once.
        pixelsIdle = true;
        floorFor = FLOOR_HOLD;
      }
      return;
    }
    // It moved, so pixels are the cost. Come back up to a little under halfway (in pixel count)
    // between the floor and where we were, and let the ordinary steps find the level from there.
    pixelsMatter = true;
    failedAt = probeSaved;
    retryAt = clock + backoff;
    q.pixelRatio = Math.max(MIN_PIXEL_RATIO, Math.sqrt((MIN_PIXEL_RATIO * MIN_PIXEL_RATIO + probeSaved * probeSaved) / 2) * STEP_DOWN);
  }

  // Step the tier down for a few seconds, at the floor resolution where it has its best chance, and
  // time it. See `finishTrial`.
  function startTrial(before: number): void {
    probing = 3;
    probeBefore = before;
    trialFrom = q.tier;
    trialAllowedAt = clock + TRIAL_AGAIN;
    q.tier = q.tier === 'high' ? 'medium' : 'low';
    q.pixelRatio = MIN_PIXEL_RATIO;
    probeUntil = clock + TRIAL_SETTLE;
    probeSum = 0;
    probeCount = 0;
    clearWindow();
  }

  function finishTrial(): void {
    probing = 0;
    slowFor = 0;
    fastFor = 0;
    floorFor = 0;
    const mean = probeCount > 0 ? probeSum / probeCount : probeBefore;
    if (mean < probeBefore * 0.8) {
      // The tier below keeps time. It stays, and resolution climbs from the floor the ordinary way.
      smoothed = mean;
      failedAt = Infinity;
      retryAt = 0;
      backoff = RETRY_FIRST;
      upFrom = 0;
      pixelsMatter = false;
      pixelsIdle = false;
      gaveUp = false;
      descentFrom = 0;
      probeAllowedAt = clock + PROBE_AGAIN;
      holdUntil = clock + SETTLE;
      return;
    }
    // No faster. Put everything back and take the slower pace as this device's rhythm.
    q.tier = trialFrom;
    q.pixelRatio = Math.min(probeSaved, pixelRatioCap(q.tier));
    base = probeBefore;
    smoothed = probeBefore;
    holdUntil = clock + TIER_SETTLE;
  }

  function adapt(dt: number): void {
    const cap = pixelRatioCap(q.tier);

    if (probing !== 0) {
      if (probing === 1 || probing === 3) {
        if (clock >= probeUntil) {
          probeUntil = clock + (probing === 1 ? PROBE_MEASURE : TRIAL_MEASURE);
          probing++;
        }
      } else {
        probeSum += dt;
        probeCount++;
        if (clock >= probeUntil) {
          if (probing === 2) finishProbe();
          else finishTrial();
        }
      }
      return;
    }

    if (clock < holdUntil) return;

    const slow = smoothed > slowLine();
    const fast = smoothed < fastLine();
    slowFor = slow ? slowFor + dt : 0;
    fastFor = fast ? fastFor + dt : 0;

    if (slowFor >= SLOW_HOLD) {
      if (q.pixelRatio > MIN_PIXEL_RATIO + 0.005 && !pixelsIdle && !gaveUp) {
        floorFor = 0;
        const steppedUp = clock - lastUpAt < 12 && upFrom > 0 && upFrom < q.pixelRatio;
        if (!steppedUp && !pixelsMatter && steady && steadyMean > base * 1.7 && clock >= probeAllowedAt) {
          startProbe();
          return;
        }
        if (descentFrom === 0) {
          descentFrom = q.pixelRatio;
          descentMs = smoothed;
        }
        failedAt = q.pixelRatio;
        if (steppedUp) {
          // The step up we just tried is what broke it. Go back to exactly where it was fine,
          // and wait twice as long before trying that step again. It was on time one step down,
          // so resolution is what sets the pace here and there is nothing to probe.
          pixelsMatter = true;
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
        // Resolution has bottomed out, or has been shown not to matter. Only now is the tier allowed to give.
        floorFor += dt;
        if (floorFor >= FLOOR_HOLD) {
          if (!tierPinned && q.tier !== 'low') {
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
          } else if (!gaveUp) {
            // Nothing left to give and it is still slow. If the walk down to the floor bought next to
            // nothing, the cost is not in the pixels: stop blurring a picture that is slow anyway.
            gaveUp = true;
            floorFor = 0;
            slowFor = 0;
            if (descentFrom > 0 && smoothed > descentMs * 0.85) {
              q.pixelRatio = Math.min(1, cap, descentFrom);
              failedAt = Infinity;
              holdUntil = clock + SETTLE;
            }
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
      // Frames on time again: whatever was concluded while it was slow no longer holds.
      gaveUp = false;
      pixelsIdle = false;
      descentFrom = 0;
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
      const held = tierPinned && fromUrl !== null; // ?q= holds the resolution at the ceiling too
      if (held) {
        if (q.pixelRatio !== cap) q.pixelRatio = cap;
      } else if (q.pixelRatio > cap) {
        q.pixelRatio = cap;
      }

      if (dtSeconds > 0 && dtSeconds <= HITCH) {
        clock += dtSeconds;
        if (clock > WARMUP) {
          smoothed += (dtSeconds - smoothed) * (1 - Math.exp(-dtSeconds / 0.3));
          q.frameMs = smoothed * 1000;
          if (!held) {
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
          if (probing >= 3) q.tier = trialFrom;
          probing = 0;
          q.pixelRatio = Math.min(probeSaved, pixelRatioCap(q.tier));
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
      // If the governor had already pulled the resolution down, the new tier starts from there and
      // not from its own ceiling: a change of tier is never a reason to get heavier.
      const settled = booted && ratio0 < pixelRatioCap(tier0) - 0.005;
      if (tier === 'auto') {
        q.auto = true;
        tierPinned = false;
        q.tier = guessTier(gl);
      } else {
        const pinned = parseTier(tier);
        if (!pinned) return;
        q.auto = false;
        tierPinned = true;
        q.tier = pinned;
      }
      if (tierPinned && fromUrl !== null) q.pixelRatio = pixelRatioCap(q.tier);
      else q.pixelRatio = settled ? Math.min(ratio0, pixelRatioCap(q.tier)) : startRatio(q.tier);
      booted = true;
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

    setLook(name: string): void {
      if (name === lookName) return;
      const tier0 = q.tier;
      const ratio0 = q.pixelRatio;
      // A probe or a trial in flight belongs to the look that is leaving. Put its values back first.
      if (probing !== 0) {
        if (probing >= 3) q.tier = trialFrom;
        q.pixelRatio = Math.min(probeSaved, pixelRatioCap(q.tier));
        probing = 0;
      }
      looks.set(lookName, { tier: q.tier, pixelRatio: q.pixelRatio, auto: !tierPinned });
      lookName = name;
      const back = looks.get(name);
      if (back) {
        if (!tierPinned && back.auto) q.tier = back.tier;
        q.pixelRatio = Math.min(back.pixelRatio, pixelRatioCap(q.tier));
      }
      if (tierPinned && fromUrl !== null) q.pixelRatio = pixelRatioCap(q.tier);
      // Whatever the frames said belongs to the other picture. Start counting again, after the files have gone up.
      resetStats();
      holdUntil = clock + TIER_SETTLE;
      if (q.tier !== tier0 || q.pixelRatio !== ratio0) emit();
    },
  };

  q.setTier(first);
  return q;
}
