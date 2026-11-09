// Keyboard, mouse, touch and gamepad, folded into one small state object the controller reads.
//
// Events only write into pending accumulators. `update()` publishes them into `state` once a frame and
// `endFrame()` clears the one-frame parts, so nothing is lost when an event lands mid-frame and nothing
// is read twice. No pointer lock anywhere: this is a page someone opened from a resume, and it should
// never grab their mouse.
//
// Sign conventions, the same for every device:
//   moveX   right is positive          moveY   forward is positive
//   lookDX  positive = dragged or pushed right        lookDY  positive = dragged or pushed down
//   zoom    positive = pull the camera back (wheel down, pinch in), about 1 per wheel notch

export interface InputState {
  moveX: number; // -1..1, right is positive
  moveY: number; // -1..1, forward is positive
  run: boolean;
  lookDX: number; // accumulated look delta in radians since last consume, yaw
  lookDY: number; // pitch
  zoom: number; // accumulated wheel or pinch delta since last consume
  interact: boolean; // true for one frame when pressed
  map: boolean; // true for one frame when pressed
  escape: boolean; // true for one frame when pressed
  any: boolean; // true once the visitor has given any movement input (for hiding hints)
}

export interface Input {
  state: InputState;
  /** True while the visitor is using a touch screen. Can flip on a laptop that has both. */
  isTouch: boolean;
  hasGamepad: boolean;
  /** Call once per frame before reading. Polls the gamepad and publishes edges and deltas. */
  update(): void;
  /** Clears deltas and one-frame flags. Call after everything has read the state. */
  endFrame(): void;
  /** When off, state reads as neutral and held keys are dropped (overlays are open). */
  setEnabled(on: boolean): void;
  /** Mount the on-screen joystick and buttons into `root`, or remove them with null.
   *  Safe to call on any device: the controls stay hidden until a finger touches the screen. */
  setTouchUi(root: HTMLElement | null): void;
  /** Called on a quick tap or click on the canvas that was not a drag, with the client position.
   *  Fires from inside the event, so it counts as a user gesture. Does not set `state.interact`. */
  onInteractTap(cb: ((clientX: number, clientY: number) => void) | null): void;
  dispose(): void;
}

const INK = '#1c1a33';
const PAPER = '#f6ecd9';
const ORANGE = '#ef7a1e';

const MOUSE_LOOK = 0.0045; // radians per CSS pixel
const TOUCH_LOOK = 0.0055;
const PAD_YAW = 2.8; // radians per second at full deflection
const PAD_PITCH = 1.7;
const PAD_ZOOM = 4; // zoom units per second on the d-pad
const PAD_DEAD = 0.18;
const STICK_ZONE = 0.45; // the left part of the screen that belongs to the thumb stick
const STICK_RADIUS = 52; // CSS pixels of travel
const STICK_FOLLOW = 1.35; // past this many radii the base is dragged along
const STICK_DEAD = 0.14;
const STICK_RUN = 0.92;
const TAP_MS = 300;
const TAP_SLOP = 9; // pixels a finger may wander and still be a tap
const PINCH_PIXELS = 90; // pinch distance that equals one wheel notch

const STYLE_ID = 'ls-input-style';

// Everything the touch controls need. Paper discs with an ink line and a hard ink drop, like the
// lettering plates in the world. Kept clear of notches and home bars with the safe-area insets.
const CSS = `
.ls-touch{position:fixed;inset:0;z-index:0;pointer-events:none;overflow:hidden;opacity:1;transition:opacity .18s ease;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:none}
.ls-touch[hidden]{display:none}
.ls-touch.ls-off{opacity:0}
.ls-touch.ls-off .ls-btn{pointer-events:none}
.ls-hint{position:absolute;left:calc(30px + env(safe-area-inset-left,0px));bottom:calc(34px + env(safe-area-inset-bottom,0px));
  width:104px;height:104px;box-sizing:border-box;border-radius:50%;border:2px dashed ${INK};opacity:.3;transition:opacity .2s ease}
.ls-hint::after{content:"";position:absolute;left:50%;top:50%;width:42px;height:42px;margin:-21px 0 0 -21px;box-sizing:border-box;
  border-radius:50%;background:${PAPER};border:2px solid ${INK}}
.ls-touch.ls-moved .ls-hint{opacity:.16}
.ls-base,.ls-knob{position:absolute;left:0;top:0;box-sizing:border-box;border-radius:50%;opacity:0;will-change:transform,opacity;transition:opacity .1s ease}
.ls-base{width:${STICK_RADIUS * 2 + 12}px;height:${STICK_RADIUS * 2 + 12}px;margin:-${STICK_RADIUS + 6}px 0 0 -${STICK_RADIUS + 6}px;
  border:2.5px solid ${INK};background:rgba(246,236,217,.4)}
.ls-knob{width:54px;height:54px;margin:-27px 0 0 -27px;border:2.5px solid ${INK};background:${PAPER};box-shadow:0 3px 0 ${INK}}
.ls-knob.ls-run{background:${ORANGE}}
.ls-touch.ls-stick .ls-base,.ls-touch.ls-stick .ls-knob{opacity:1}
.ls-touch.ls-stick .ls-hint{opacity:0}
.ls-btns{position:absolute;right:calc(18px + env(safe-area-inset-right,0px));bottom:calc(26px + env(safe-area-inset-bottom,0px));width:76px;height:150px}
.ls-btn{position:absolute;pointer-events:auto;-webkit-appearance:none;appearance:none;box-sizing:border-box;margin:0;padding:0;
  display:flex;align-items:center;justify-content:center;border-radius:50%;border:2.5px solid ${INK};background:${PAPER};color:${INK};
  box-shadow:0 4px 0 ${INK};cursor:pointer;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;
  -webkit-tap-highlight-color:transparent;transition:transform .06s ease,box-shadow .06s ease}
.ls-btn svg{width:54%;height:54%;display:block;pointer-events:none;fill:none;stroke:${INK};stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}
.ls-btn .ls-fill{fill:${INK};stroke:none}
.ls-btn.ls-down{transform:translateY(4px);box-shadow:0 0 0 ${INK};background:#fff7e6}
.ls-btn:focus{outline:none}
.ls-btn:focus-visible{outline:3px solid ${ORANGE};outline-offset:3px}
.ls-look{right:0;bottom:0;width:76px;height:76px}
.ls-map{right:8px;bottom:90px;width:60px;height:60px}
@media (max-height:420px){.ls-btns{width:150px;height:76px}.ls-map{right:90px;bottom:8px}}
@media (prefers-reduced-motion:reduce){.ls-touch,.ls-hint,.ls-base,.ls-knob,.ls-btn{transition:none}}
`;

const ICON_LOOK =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12c2.9-4.6 6.2-6.9 10-6.9s7.1 2.3 10 6.9c-2.9 4.6-6.2 6.9-10 6.9S4.900 16.600 2 12z"/><circle class="ls-fill" cx="12" cy="12" r="2.900"/></svg>';
const ICON_MAP =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.600l6-2.400 6 2.400 6-2.400v13.200l-6 2.400-6-2.400-6 2.400z"/><path d="M9 4.200v13.200M15 6.600v13.200"/></svg>';

// Keys can arrive without a `code` from some on-screen and remote keyboards. Fall back to the letter.
function codeOf(e: KeyboardEvent): string {
  if (e.code) return e.code;
  const k = e.key;
  if (k.length === 1) {
    if (k === ' ') return 'Space';
    const c = k.toUpperCase();
    if (c >= 'A' && c <= 'Z') return 'Key' + c;
    return '';
  }
  if (k === 'Shift') return 'ShiftLeft';
  if (k === 'Esc') return 'Escape';
  return k; // ArrowUp, Enter, Escape and friends share their names with the codes
}

const FIELD = 'input,textarea,select,button,a[href],summary,[contenteditable]:not([contenteditable="false"]),[role="button"],[role="link"],[role="textbox"]';

export function createInput(canvas: HTMLCanvasElement): Input {
  const state: InputState = {
    moveX: 0,
    moveY: 0,
    run: false,
    lookDX: 0,
    lookDY: 0,
    zoom: 0,
    interact: false,
    map: false,
    escape: false,
    any: false,
  };

  let enabled = true;
  let enabledAt = 0; // event time stamps at or before this belong to whatever closed the overlay
  let disposed = false;
  let tapCb: ((clientX: number, clientY: number) => void) | null = null;
  let lastUpdate = performance.now();

  // Held keys. Two flags per direction so letting go of W while Up is still down keeps walking.
  let kW = false, kA = false, kS = false, kD = false;
  let kUp = false, kLeft = false, kDown = false, kRight = false;
  let kShiftL = false, kShiftR = false;

  // Written by events, published by update().
  let pLookX = 0;
  let pLookY = 0;
  let pZoom = 0;
  let pInteract = false;
  let pMap = false;
  let pEscape = false;

  // Pointers. One thumb on the stick, and up to two more for looking and pinching.
  let stickId = -1;
  let stickOX = 0, stickOY = 0; // where the base sits
  let stickPX = 0, stickPY = 0; // where the thumb is
  let stickX = 0, stickY = 0; // output, dead zone applied
  let stickRun = false;
  let stickDirty = false;
  let stickDownAt = 0, stickTravel = 0;
  let aId = -1, aX = 0, aY = 0, aMouse = false;
  let aDownAt = 0, aTravel = 0, aPinched = false;
  let bId = -1, bX = 0, bY = 0;

  // Gamepad.
  let padCount = 0;
  let padBroken = false;
  let padX = 0, padY = 0;
  let padRun = false;
  let padRunLatch = false;
  let padButtons = 0; // last frame's buttons, one bit each

  // Touch controls.
  let touchPrimary = false;
  if (typeof matchMedia === 'function') {
    touchPrimary =
      matchMedia('(pointer: coarse)').matches ||
      (matchMedia('(any-pointer: coarse)').matches && matchMedia('(hover: none)').matches);
  }
  let ui: HTMLDivElement | null = null;
  let baseEl: HTMLDivElement | null = null;
  let knobEl: HTMLDivElement | null = null;
  let styleEl: HTMLStyleElement | null = null;
  let uiStickShown = false;
  let uiRunShown = false;
  let uiMovedShown = false;
  let buttonDownAt = -1e9;

  // -------------------------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------------------------

  function clearKeys(): void {
    kW = kA = kS = kD = false;
    kUp = kLeft = kDown = kRight = false;
    kShiftL = kShiftR = false;
  }

  function setKey(code: string, down: boolean): boolean {
    switch (code) {
      case 'KeyW': kW = down; return true;
      case 'KeyA': kA = down; return true;
      case 'KeyS': kS = down; return true;
      case 'KeyD': kD = down; return true;
      case 'ArrowUp': kUp = down; return true;
      case 'ArrowLeft': kLeft = down; return true;
      case 'ArrowDown': kDown = down; return true;
      case 'ArrowRight': kRight = down; return true;
      case 'ShiftLeft': kShiftL = down; return true;
      case 'ShiftRight': kShiftR = down; return true;
      default: return false;
    }
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!enabled || e.isComposing) return;
    // Leave browser and system shortcuts alone. A held Command also swallows key-up events on a Mac,
    // so drop everything rather than risk a key that never comes back up.
    if (e.metaKey || e.ctrlKey || e.altKey) {
      if (e.metaKey) clearKeys();
      return;
    }
    const code = codeOf(e);
    const target = e.target;
    if (target instanceof Element && target !== canvas && target.closest(FIELD)) {
      // Typing, or a focused button or link: the key belongs to that control. The one kindness is
      // Escape on a stray focused button, which hands the keyboard back to the world.
      if (code === 'Escape' && target instanceof HTMLElement && !target.closest('input,textarea,select,[contenteditable],[role="dialog"],dialog')) {
        target.blur();
      }
      return;
    }
    if (setKey(code, true)) {
      // Arrows would scroll a page that could scroll.
      if (code.charCodeAt(0) === 65 /* A of Arrow */) e.preventDefault();
      return;
    }
    const fresh = !e.repeat && e.timeStamp > enabledAt;
    switch (code) {
      case 'Space':
        e.preventDefault();
        if (fresh) pInteract = true;
        break;
      case 'KeyE':
      case 'Enter':
      case 'NumpadEnter':
        if (fresh) pInteract = true;
        break;
      case 'KeyM':
        if (fresh) pMap = true;
        break;
      case 'Escape':
        if (fresh) pEscape = true;
        break;
    }
  }

  // Key-up is always honoured, enabled or not, focused or not. A key must never stick down.
  function onKeyUp(e: KeyboardEvent): void {
    const code = codeOf(e);
    if (code === 'MetaLeft' || code === 'MetaRight' || e.key === 'Meta') clearKeys();
    else setKey(code, false);
  }

  // -------------------------------------------------------------------------------------------
  // Pointers: mouse drag, touch stick, touch look, pinch
  // -------------------------------------------------------------------------------------------

  function capture(id: number): void {
    try {
      canvas.setPointerCapture(id);
    } catch {
      // The pointer is already gone. Nothing to hold on to.
    }
  }

  function release(id: number): void {
    try {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } catch {
      // Same.
    }
  }

  function dropStick(): void {
    stickId = -1;
    stickX = 0;
    stickY = 0;
    stickRun = false;
    stickDirty = true;
  }

  function dropPointers(): void {
    if (stickId >= 0) release(stickId);
    if (aId >= 0) release(aId);
    if (bId >= 0) release(bId);
    dropStick();
    aId = -1;
    bId = -1;
    if (aMouse) canvas.style.cursor = 'grab';
    aMouse = false;
  }

  function solveStick(): void {
    let dx = stickPX - stickOX;
    let dy = stickPY - stickOY;
    let len = Math.sqrt(dx * dx + dy * dy);
    // A thumb that slides far past the rim takes the base with it, so reversing is never a long haul.
    const limit = STICK_RADIUS * STICK_FOLLOW;
    if (len > limit) {
      const pull = (len - limit) / len;
      stickOX += dx * pull;
      stickOY += dy * pull;
      dx = stickPX - stickOX;
      dy = stickPY - stickOY;
      len = limit;
    }
    const amount = Math.min(1, len / STICK_RADIUS);
    if (amount <= STICK_DEAD || len === 0) {
      stickX = 0;
      stickY = 0;
      stickRun = false;
    } else {
      const scaled = (amount - STICK_DEAD) / (1 - STICK_DEAD);
      stickX = (dx / len) * scaled;
      stickY = (-dy / len) * scaled;
      stickRun = amount >= STICK_RUN;
    }
    stickDirty = true;
  }

  function onPointerDown(e: PointerEvent): void {
    if (!enabled) return;
    const mouse = e.pointerType === 'mouse';
    if (mouse) {
      if (e.button !== 0 && e.button !== 2) return;
      if (aId >= 0) return;
    } else if (stickId < 0 && e.clientX < window.innerWidth * STICK_ZONE) {
      stickId = e.pointerId;
      stickOX = stickPX = e.clientX;
      stickOY = stickPY = e.clientY;
      stickDownAt = e.timeStamp;
      stickTravel = 0;
      solveStick();
      capture(e.pointerId);
      return;
    }
    if (aId < 0) {
      aId = e.pointerId;
      aX = e.clientX;
      aY = e.clientY;
      aMouse = mouse;
      aDownAt = e.button === 0 || !mouse ? e.timeStamp : -1e9;
      aTravel = 0;
      aPinched = false;
      if (mouse) canvas.style.cursor = 'grabbing';
    } else if (bId < 0 && !mouse && !aMouse) {
      bId = e.pointerId;
      bX = e.clientX;
      bY = e.clientY;
      aPinched = true;
    } else {
      return;
    }
    capture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    const id = e.pointerId;
    if (id === stickId) {
      stickTravel += Math.abs(e.clientX - stickPX) + Math.abs(e.clientY - stickPY);
      stickPX = e.clientX;
      stickPY = e.clientY;
      solveStick();
    } else if (id === aId || id === bId) {
      const first = id === aId;
      const dx = e.clientX - (first ? aX : bX);
      const dy = e.clientY - (first ? aY : bY);
      if (bId >= 0) {
        // Two fingers: the change in their spread is the zoom. Spreading pulls the camera in.
        const before = Math.hypot(aX - bX, aY - bY);
        if (first) {
          aX = e.clientX;
          aY = e.clientY;
        } else {
          bX = e.clientX;
          bY = e.clientY;
        }
        pZoom += (before - Math.hypot(aX - bX, aY - bY)) / PINCH_PIXELS;
      } else {
        aX = e.clientX;
        aY = e.clientY;
        aTravel += Math.abs(dx) + Math.abs(dy);
        const k = aMouse ? MOUSE_LOOK : TOUCH_LOOK;
        pLookX += dx * k;
        pLookY += dy * k;
      }
    }
  }

  function endPointer(e: PointerEvent, lifted: boolean): void {
    const id = e.pointerId;
    let tap = false;
    if (id === stickId) {
      tap = lifted && e.timeStamp - stickDownAt < TAP_MS && stickTravel < TAP_SLOP;
      dropStick();
    } else if (id === aId) {
      tap = lifted && bId < 0 && !aPinched && e.timeStamp - aDownAt < TAP_MS && aTravel < TAP_SLOP;
      if (aMouse) canvas.style.cursor = 'grab';
      if (bId >= 0) {
        // The other finger carries on as the look finger.
        aId = bId;
        aX = bX;
        aY = bY;
        aMouse = false;
        bId = -1;
      } else {
        aId = -1;
        aMouse = false;
      }
    } else if (id === bId) {
      bId = -1;
    } else {
      return;
    }
    release(id);
    if (tap && enabled && tapCb) tapCb(e.clientX, e.clientY);
  }

  function onPointerUp(e: PointerEvent): void {
    endPointer(e, true);
  }

  function onPointerCancel(e: PointerEvent): void {
    endPointer(e, false);
  }

  function onWheel(e: WheelEvent): void {
    // Always swallowed, so a trackpad pinch (which arrives as ctrl + wheel) zooms the camera and not the page.
    e.preventDefault();
    if (!enabled) return;
    let d = e.deltaY;
    if (e.deltaMode === 1) d *= 33; // lines
    else if (e.deltaMode === 2) d *= 400; // pages
    d = e.ctrlKey ? d / 12 : d / 100;
    pZoom += d > 3 ? 3 : d < -3 ? -3 : d;
  }

  function stop(e: Event): void {
    e.preventDefault();
  }

  // -------------------------------------------------------------------------------------------
  // Touch or not. A laptop can have both, so follow whatever was used last.
  // -------------------------------------------------------------------------------------------

  function showTouchUi(): void {
    if (ui) ui.hidden = !input.isTouch;
  }

  function onAnyPointerDown(e: PointerEvent): void {
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    if (touch === input.isTouch || (!touch && touchPrimary)) return;
    input.isTouch = touch;
    showTouchUi();
  }

  // -------------------------------------------------------------------------------------------
  // Losing the window. Whatever was held is no longer held.
  // -------------------------------------------------------------------------------------------

  function releaseAll(): void {
    clearKeys();
    dropPointers();
    padRunLatch = false;
    pLookX = 0;
    pLookY = 0;
    pZoom = 0;
  }

  function onVisibility(): void {
    if (document.visibilityState !== 'visible') releaseAll();
  }

  // -------------------------------------------------------------------------------------------
  // Gamepad
  // -------------------------------------------------------------------------------------------

  function onPadConnect(): void {
    padCount++;
    input.hasGamepad = true;
  }

  function onPadDisconnect(): void {
    padCount = Math.max(0, padCount - 1);
    if (padCount === 0) {
      input.hasGamepad = false;
      padX = 0;
      padY = 0;
      padRun = false;
      padRunLatch = false;
      padButtons = 0;
    }
  }

  function pressed(pad: Gamepad, index: number): boolean {
    const b = pad.buttons[index];
    return b !== undefined && (b.pressed || b.value > 0.5);
  }

  function pollPad(dt: number): void {
    if (padCount === 0 || padBroken) return;
    let pad: Gamepad | null = null;
    try {
      const pads = navigator.getGamepads();
      for (let i = 0; i < pads.length; i++) {
        const candidate = pads[i];
        if (candidate && candidate.connected && candidate.axes.length >= 2) {
          pad = candidate;
          if (candidate.mapping === 'standard') break;
        }
      }
    } catch {
      padBroken = true; // blocked by a permissions policy; stop asking
      return;
    }
    if (!pad) {
      padX = 0;
      padY = 0;
      padRun = false;
      return;
    }

    // Left stick, with a round dead zone so slow diagonals do not snap to the axes.
    const lx = pad.axes[0] || 0;
    const ly = pad.axes[1] || 0;
    const lm = Math.sqrt(lx * lx + ly * ly);
    if (lm > PAD_DEAD) {
      const s = Math.min(1, (lm - PAD_DEAD) / (1 - PAD_DEAD)) / lm;
      padX = lx * s;
      padY = -ly * s;
    } else {
      padX = 0;
      padY = 0;
      padRunLatch = false; // a stick click keeps you running until you stop
    }

    // Right stick. Squared so small pushes aim finely.
    const rx = pad.axes[2] || 0;
    const ry = pad.axes[3] || 0;
    const rm = Math.sqrt(rx * rx + ry * ry);
    if (rm > PAD_DEAD && enabled) {
      const t = Math.min(1, (rm - PAD_DEAD) / (1 - PAD_DEAD));
      const s = (t * t) / rm;
      pLookX += rx * s * PAD_YAW * dt;
      pLookY += ry * s * PAD_PITCH * dt;
    }

    let now = 0;
    if (pressed(pad, 0)) now |= 1; // A
    if (pressed(pad, 1)) now |= 2; // B
    if (pressed(pad, 3)) now |= 4; // Y
    if (pressed(pad, 9)) now |= 8; // Start
    if (pressed(pad, 10) || pressed(pad, 11)) now |= 16; // stick clicks
    const down = now & ~padButtons;
    padButtons = now;

    if (down & 16) padRunLatch = !padRunLatch;
    const lt = pad.buttons[6];
    const rt = pad.buttons[7];
    padRun = padRunLatch || (lt !== undefined && lt.value > 0.3) || (rt !== undefined && rt.value > 0.3) || pressed(pad, 6) || pressed(pad, 7);

    if (enabled) {
      if (down & 1) pInteract = true;
      if (down & (4 | 8)) pMap = true;
      if (down & 2) pEscape = true;
      // D-pad up and down move the camera in and out.
      if (pressed(pad, 12)) pZoom -= PAD_ZOOM * dt;
      if (pressed(pad, 13)) pZoom += PAD_ZOOM * dt;
    } else if (down & 3) {
      // An overlay is open and it listens to the keyboard, not to us. Pass the pad on in the
      // overlay's own terms: B is Escape, A presses whichever button has focus.
      const focus = document.activeElement;
      if (down & 2) {
        (focus || document.body).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }),
        );
      } else if (focus instanceof HTMLElement && focus.matches('button,a[href],[role="button"]')) {
        focus.click();
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // On-screen controls
  // -------------------------------------------------------------------------------------------

  function button(cls: string, label: string, icon: string, press: () => void): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'ls-btn ' + cls;
    el.setAttribute('aria-label', label);
    el.innerHTML = icon;
    el.addEventListener('pointerdown', (e) => {
      // Act on the way down: no waiting for a click, no 300 ms.
      e.preventDefault();
      e.stopPropagation();
      buttonDownAt = performance.now();
      el.classList.add('ls-down');
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Fine without it.
      }
      if (enabled) press();
    });
    const up = (): void => {
      el.classList.remove('ls-down');
      el.blur(); // do not leave focus parked here, or the keyboard goes quiet on a laptop
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
    // A click with no pointer before it came from a keyboard or a screen reader.
    el.addEventListener('click', () => {
      if (performance.now() - buttonDownAt > 700 && enabled) press();
    });
    el.addEventListener('contextmenu', stop);
    return el;
  }

  function unmountTouchUi(): void {
    if (ui) ui.remove();
    ui = null;
    baseEl = null;
    knobEl = null;
    uiStickShown = false;
    uiRunShown = false;
    uiMovedShown = false;
  }

  function mountTouchUi(root: HTMLElement): void {
    if (!document.getElementById(STYLE_ID)) {
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      styleEl.textContent = CSS;
      document.head.appendChild(styleEl);
    }
    ui = document.createElement('div');
    ui.className = enabled ? 'ls-touch' : 'ls-touch ls-off';
    ui.hidden = !input.isTouch;

    const hint = document.createElement('div');
    hint.className = 'ls-hint';
    hint.setAttribute('aria-hidden', 'true');
    baseEl = document.createElement('div');
    baseEl.className = 'ls-base';
    baseEl.setAttribute('aria-hidden', 'true');
    knobEl = document.createElement('div');
    knobEl.className = 'ls-knob';
    knobEl.setAttribute('aria-hidden', 'true');

    const buttons = document.createElement('div');
    buttons.className = 'ls-btns';
    buttons.appendChild(button('ls-map', 'Open the map', ICON_MAP, () => { pMap = true; }));
    buttons.appendChild(button('ls-look', 'Look closer', ICON_LOOK, () => { pInteract = true; }));

    ui.append(hint, baseEl, knobEl, buttons);
    // First child, so panels and menus added to the same root later paint over the controls.
    root.insertBefore(ui, root.firstChild);
    stickDirty = true;
  }

  // Runs from update(), so the DOM is touched at most once a frame and only when something moved.
  function drawStick(): void {
    stickDirty = false;
    if (!ui || !baseEl || !knobEl) return;
    const on = stickId >= 0;
    if (on !== uiStickShown) {
      uiStickShown = on;
      ui.classList.toggle('ls-stick', on);
    }
    if (stickRun !== uiRunShown) {
      uiRunShown = stickRun;
      knobEl.classList.toggle('ls-run', stickRun);
    }
    if (state.any && !uiMovedShown) {
      uiMovedShown = true;
      ui.classList.add('ls-moved');
    }
    if (!on) return;
    let dx = stickPX - stickOX;
    let dy = stickPY - stickOY;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > STICK_RADIUS) {
      dx *= STICK_RADIUS / len;
      dy *= STICK_RADIUS / len;
    }
    baseEl.style.transform = 'translate3d(' + stickOX.toFixed(1) + 'px,' + stickOY.toFixed(1) + 'px,0)';
    knobEl.style.transform = 'translate3d(' + (stickOX + dx).toFixed(1) + 'px,' + (stickOY + dy).toFixed(1) + 'px,0)';
  }

  // -------------------------------------------------------------------------------------------
  // The public object
  // -------------------------------------------------------------------------------------------

  function neutral(): void {
    state.moveX = 0;
    state.moveY = 0;
    state.run = false;
    state.lookDX = 0;
    state.lookDY = 0;
    state.zoom = 0;
    state.interact = false;
    state.map = false;
    state.escape = false;
  }

  const input: Input = {
    state,
    isTouch: touchPrimary,
    hasGamepad: false,

    update(): void {
      const now = performance.now();
      let dt = (now - lastUpdate) / 1000;
      lastUpdate = now;
      if (dt > 0.1) dt = 0.1;
      else if (dt < 0) dt = 0;
      pollPad(dt);

      if (!enabled) {
        neutral();
        pLookX = 0;
        pLookY = 0;
        pZoom = 0;
        pInteract = false;
        pMap = false;
        pEscape = false;
        if (stickDirty) drawStick();
        return;
      }

      let mx = (kD || kRight ? 1 : 0) - (kA || kLeft ? 1 : 0);
      let my = (kW || kUp ? 1 : 0) - (kS || kDown ? 1 : 0);
      mx += stickX + padX;
      my += stickY + padY;
      const len = Math.sqrt(mx * mx + my * my);
      if (len > 1) {
        mx /= len;
        my /= len;
      }
      state.moveX = mx;
      state.moveY = my;
      state.run = kShiftL || kShiftR || stickRun || padRun;
      if (len > 0.01) state.any = true;

      state.lookDX += pLookX;
      state.lookDY += pLookY;
      state.zoom += pZoom;
      pLookX = 0;
      pLookY = 0;
      pZoom = 0;
      if (pInteract) state.interact = true;
      if (pMap) state.map = true;
      if (pEscape) state.escape = true;
      pInteract = false;
      pMap = false;
      pEscape = false;

      if (stickDirty || (state.any && !uiMovedShown && ui)) drawStick();
    },

    endFrame(): void {
      state.lookDX = 0;
      state.lookDY = 0;
      state.zoom = 0;
      state.interact = false;
      state.map = false;
      state.escape = false;
    },

    setEnabled(on: boolean): void {
      if (on === enabled) return;
      enabled = on;
      releaseAll();
      pInteract = false;
      pMap = false;
      pEscape = false;
      neutral();
      // The key or click that closed an overlay must not also count as a press in the world.
      if (on) enabledAt = performance.now();
      if (ui) ui.classList.toggle('ls-off', !on);
    },

    setTouchUi(root: HTMLElement | null): void {
      unmountTouchUi();
      if (root && !disposed) mountTouchUi(root);
    },

    onInteractTap(cb: ((clientX: number, clientY: number) => void) | null): void {
      tapCb = cb;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      enabled = false;
      releaseAll();
      neutral();
      unmountTouchUi();
      if (styleEl) styleEl.remove();
      styleEl = null;
      tapCb = null;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', releaseAll);
      window.removeEventListener('pagehide', releaseAll);
      window.removeEventListener('contextmenu', clearKeys);
      window.removeEventListener('pointerdown', onAnyPointerDown, true);
      window.removeEventListener('gamepadconnected', onPadConnect);
      window.removeEventListener('gamepaddisconnected', onPadDisconnect);
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('lostpointercapture', onPointerCancel);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', stop);
      canvas.removeEventListener('selectstart', stop);
      canvas.removeEventListener('dragstart', stop);
      canvas.removeEventListener('gesturestart', stop);
      const s = canvas.style;
      s.removeProperty('touch-action');
      s.removeProperty('user-select');
      s.removeProperty('-webkit-user-select');
      s.removeProperty('-webkit-touch-callout');
      s.removeProperty('-webkit-tap-highlight-color');
      s.removeProperty('cursor');
    },
  };

  // The canvas takes every gesture itself: no scrolling, no zooming, no selection, no long-press menu.
  const cs = canvas.style;
  cs.setProperty('touch-action', 'none');
  cs.setProperty('user-select', 'none');
  cs.setProperty('-webkit-user-select', 'none');
  cs.setProperty('-webkit-touch-callout', 'none');
  cs.setProperty('-webkit-tap-highlight-color', 'transparent');
  cs.setProperty('cursor', 'grab');

  const passive: AddEventListenerOptions = { passive: true };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp, passive);
  window.addEventListener('blur', releaseAll, passive);
  window.addEventListener('pagehide', releaseAll, passive);
  window.addEventListener('contextmenu', clearKeys, passive);
  window.addEventListener('pointerdown', onAnyPointerDown, { passive: true, capture: true });
  window.addEventListener('gamepadconnected', onPadConnect, passive);
  window.addEventListener('gamepaddisconnected', onPadDisconnect, passive);
  document.addEventListener('visibilitychange', onVisibility, passive);
  canvas.addEventListener('pointerdown', onPointerDown, passive);
  canvas.addEventListener('pointermove', onPointerMove, passive);
  canvas.addEventListener('pointerup', onPointerUp, passive);
  canvas.addEventListener('pointercancel', onPointerCancel, passive);
  canvas.addEventListener('lostpointercapture', onPointerCancel, passive);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', stop);
  canvas.addEventListener('selectstart', stop);
  canvas.addEventListener('dragstart', stop);
  canvas.addEventListener('gesturestart', stop); // older iOS page pinch

  // A pad that was already awake before the page loaded does not announce itself again.
  try {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    for (let i = 0; i < pads.length; i++) if (pads[i]) padCount++;
    input.hasGamepad = padCount > 0;
  } catch {
    padBroken = true;
  }

  return input;
}
