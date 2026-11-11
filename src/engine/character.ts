// The visitor's figure. A Black teenager, lean, about 1.72 m: rope twists tied up in a short high
// bunch, a cropped orange shell over a long tee, tapered cargo trousers, chunky trainers, a sling
// bag across his back and one glove. He faces -z in his own space (yaw 0 looks north), so the back
// of the shell is +z, and the back is what the visitor sees all day.
//
// How he is put together:
//   characterGeo.ts    lofted shapes
//   characterSkin.ts   soft joints: a sleeve bends at the elbow as one piece of cloth
//   characterBody.ts   the clothes, neck down
//   characterHead.ts   face and hair
//   this file          the joints, and every bit of how he moves
// Twelve meshes, all on the ink material. Nothing is allocated once he is built.
import * as THREE from 'three';
import type { InkKit, QualityTier } from '../types';
import { clamp, damp, lerp, smoothstep } from './util';
import {
  ANKLE,
  ARM_FRAMES,
  BALL,
  FOOT_FRAMES,
  FOREARM,
  HEEL,
  HIP_DROP,
  HIP_FRAMES,
  HIP_W,
  LEG_FRAMES,
  NECK_UP,
  REACH,
  SHIN,
  SHOULDER_X,
  SHOULDER_Y,
  SPINE_UP,
  STAND,
  STRAP_AT,
  THIGH,
  UPPER_ARM,
  WAIST,
  buildArm,
  buildBag,
  buildChest,
  buildFoot,
  buildHips,
  buildLeg,
  buildShadow,
  detail,
  type Ids,
} from './characterBody';
import { CROWN, HAIR, HEAD_FRAMES, LID_DROP, TAIL_FRAMES, buildHead, buildTail, type HairSpec } from './characterHead';
import { turnAbout, type Skin } from './characterSkin';

export type { HairSpec };

export interface Character {
  group: THREE.Group;
  /** speed in m/s over the ground, turnRate in rad/s (positive is a left turn, yaw going up). */
  update(dt: number, t: number, speed: number, turnRate: number, grounded: boolean): void;
  /** Top of the head, scalp rows included, above the soles, metres. The tie sits behind the crown
   *  and the bunch stands about a hand's width higher still. */
  height: number;
  /** Ground slope under him in world space (rise per metre east, rise per metre south). Tilts the
   *  contact shadow and plants the feet on the hill. Optional: flat ground if never called. */
  setSlope(dhdx: number, dhdz: number): void;
  /** Put the animation in a known state, for stills. */
  reset(): void;
  /** Reduced motion: hair, bag and hem settle without bouncing, and he stops shifting his weight,
   *  looking about and blinking. His stride is untouched. */
  setCalm?(on: boolean): void;
}

export interface CharacterOptions {
  /** On 'low' everything gets fewer rings and sides. Default is the full figure. */
  tier?: QualityTier;
  /** Override any of the hair numbers. For the test page. */
  hair?: Partial<HairSpec>;
}

const TAU = Math.PI * 2;
const WRIST = UPPER_ARM + FOREARM;
// Drawn a little big for his body, the way a comic draws a boy.
const HEAD_SCALE = 1.06;

// How far the bunch may swing before the tips would touch the head or the collar.
const LEAN_BACK = 0.42;
const LEAN_FWD = 0.2;
const LEAN_SIDE = 0.3;

// Standing. The leg that carries him sits under its hip. The easy leg is out in front and wide.
const STAND_X = 0.088;
const STAND_Z = 0;
const EASY_X = 0.128;
const EASY_Z = -0.105;
const EASY_PITCH = 0.16; // heel of the easy foot off the ground
const LEG_MAX = REACH - 0.003;

interface Spring {
  x: number;
  v: number;
}

export function createCharacter(kit: InkKit, opts: CharacterOptions = {}): Character {
  const hs: HairSpec = { ...HAIR, ...opts.hair };
  const q = detail(opts.tier === 'low');
  const ids: Ids = { skin: kit.builder().newId(), seat: kit.builder().newId() };
  const group = new THREE.Group();
  group.name = 'figure';

  const shadow = buildShadow(kit);
  shadow.position.y = 0.035;
  group.add(shadow);

  // Everything that leans in a turn hangs off `body`, which pivots at the ground.
  const body = new THREE.Group();
  group.add(body);

  const pelvis = new THREE.Group();
  body.add(pelvis);
  const hips = buildHips(kit, q, ids);
  pelvis.add(hips.mesh);
  const torso = new THREE.Group();
  torso.position.set(0, SPINE_UP, 0);
  pelvis.add(torso);
  const chest = buildChest(kit, q, ids);
  torso.add(chest.mesh);
  const bag = buildBag(kit);
  bag.position.copy(chest.bagAt);
  bag.quaternion.copy(chest.bagTurn);
  torso.add(bag);
  const built = buildHead(kit, q, ids, hs);
  const head = built.skin;
  head.mesh.position.set(0, NECK_UP, 0);
  head.mesh.scale.setScalar(HEAD_SCALE);
  torso.add(head.mesh);
  const tail = buildTail(kit, q, hs, built.tie);
  tail.mesh.position.copy(built.tie);
  head.mesh.add(tail.mesh);

  // Index 0 is his left (-x), 1 is his right.
  const arm: Skin[] = [];
  const leg: Skin[] = [];
  const knee: THREE.Group[] = [];
  const foot: Skin[] = [];
  for (let i = 0; i < 2; i++) {
    const side = i === 0 ? -1 : 1;
    const a = buildArm(kit, q, side, ids);
    a.mesh.position.set(side * SHOULDER_X, SHOULDER_Y, 0.006);
    torso.add(a.mesh);
    arm.push(a);

    // Legs hang off the body. The hip joints are placed by hand each frame so the feet can be
    // solved in one flat space.
    const l = buildLeg(kit, q, side, ids);
    l.mesh.rotation.order = 'YZX';
    body.add(l.mesh);
    const k = new THREE.Group();
    k.position.set(0, -THIGH, 0);
    l.mesh.add(k);
    const f = buildFoot(kit, q, side);
    f.mesh.position.set(0, -SHIN, 0);
    k.add(f.mesh);
    leg.push(l);
    knee.push(k);
    foot.push(f);
  }

  // State. Plain numbers, nothing allocated after this point.
  let phase = 0; // one unit is two steps
  let move = 0; // 0 standing, 1 in stride
  let air = 0;
  let accel = 0;
  let prevSpeed = 0;
  let roll = 0;
  let lagY = STAND;
  let slopeX = 0;
  let slopeZ = 0;
  let calm = false;
  let lastBlink = -1;
  let gait = false; // true while the stride runs on the phase clock, false while he stands or shuffles
  let lastYaw = NaN;
  let weight = 0; // which leg carries him standing: +1 the right, -1 the left, 0 while he is in stride
  let shrug = 0;
  let sink = 0;
  // Feet. A planted foot stays where it is on the ground: the body moves and turns over it. All in
  // his own space, so a planted foot drifts back as he walks and swings round as he turns.
  const footX = [0, 0];
  const footZ = [0, 0]; // fore and aft: the point on the ground under the ankle
  const footYaw = [0, 0]; // toes turned to his left is positive
  const planted = [true, true];
  const timed = [false, false]; // taking a step on its own clock: settling after a stop, shifting weight, turning on the spot
  const stepS = [0, 0]; // how far through that step, 0 to 1
  const stepT = [0.24, 0.24];
  const stepH = [0.05, 0.05];
  const fromX = [0, 0]; // where the foot left the ground
  const fromZ = [0, 0];
  const fromYaw = [0, 0];
  const fromLift = [0, 0];
  const swingAt = [0, 0]; // how far into the swing it was when it left: a late start still lands on time
  const liftNow = [0, 0]; // height and tilt of each foot as drawn: they chase the gait, so a change of pace cannot snap them
  const pitchNow = [0, 0];
  const err = [0, 0]; // how far each planted foot is from where it belongs
  const solX = [0, 0]; // this frame's answer for each foot: where the ankle goes, and how the sole lies
  const solY = [0, 0];
  const solZ = [0, 0];
  const solPitch = [0, 0];
  const solToe = [0, 0];
  const flex = [0, 0]; // each thigh, forward of straight down
  const tailP: Spring = { x: 0, v: 0 }; // the bunch about the tie: positive lies back
  const tailS: Spring = { x: 0, v: 0 }; // positive leans to his right
  let topP = 0;
  let topS = 0;
  const bagL: Spring = { x: 0, v: 0 }; // the pouch lifting off his back
  const bagS: Spring = { x: 0, v: 0 }; // and sliding along it
  const hemX: Spring = { x: 0, v: 0 };
  const hemY: Spring = { x: 0, v: 0 };
  const hemZ: Spring = { x: 0, v: 0 };
  const webX: Spring = { x: 0, v: 0 };
  const webZ: Spring = { x: 0, v: 0 };
  const rock: Spring = { x: 0, v: 0 }; // thrown forward setting off, back pulling up, and it swings back through upright
  const springs = [tailP, tailS, bagL, bagS, hemX, hemY, hemZ, webX, webZ, rock];
  const m1 = new THREE.Matrix4();
  const m2 = new THREE.Matrix4();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();
  const ea = new THREE.Euler();
  const AX = new THREE.Vector3(1, 0, 0);
  const AY = new THREE.Vector3(0, 1, 0);
  const AZ = new THREE.Vector3(0, 0, 1);

  /** One step of a damped spring. With reduced motion it is damped hard enough that it never overshoots. */
  function pull(s: Spring, target: number, k: number, c: number, h: number): number {
    const cc = calm ? Math.max(c, 2 * Math.sqrt(k)) : c;
    s.v += ((target - s.x) * k - s.v * cc) * h;
    s.x += s.v * h;
    return s.x;
  }

  // Where each foot belongs when he stands. The leg that carries him is straight under the hip.
  // The easy leg is out in front and to the side, knee soft, toes turned out.
  const homeX = (side: number, easy: boolean): number => side * (easy ? EASY_X : STAND_X);
  const homeZ = (easy: boolean): number => (easy ? EASY_Z : STAND_Z);
  const homeYaw = (side: number, easy: boolean): number => -side * (easy ? 0.36 : 0.13);

  /** Foot i leaves the ground for one step on its own clock. */
  function startStep(i: number, time: number, height: number): void {
    timed[i] = true;
    planted[i] = false;
    stepS[i] = 0;
    stepT[i] = time;
    stepH[i] = height;
    fromX[i] = footX[i];
    fromZ[i] = footZ[i];
    fromYaw[i] = footYaw[i];
    fromLift[i] = liftNow[i];
  }

  function reset(): void {
    phase = 0;
    move = 0;
    air = 0;
    accel = 0;
    prevSpeed = 0;
    roll = 0;
    lagY = STAND;
    topP = topS = 0;
    gait = false;
    lastYaw = NaN;
    weight = 1;
    shrug = 0;
    sink = 0;
    for (const s of springs) s.x = s.v = 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const easy = side < 0; // he starts with his weight on the right leg
      footX[i] = homeX(side, easy);
      footZ[i] = homeZ(easy);
      footYaw[i] = homeYaw(side, easy);
      planted[i] = true;
      timed[i] = false;
      stepS[i] = 0;
      swingAt[i] = 0;
      liftNow[i] = 0;
      pitchNow[i] = easy ? EASY_PITCH : 0;
      err[i] = 0;
    }
  }

  function setSlope(dhdx: number, dhdz: number): void {
    slopeX = dhdx;
    slopeZ = dhdz;
  }

  function setCalm(on: boolean): void {
    calm = on;
  }

  function update(dt: number, t: number, speed: number, turnRate: number, grounded: boolean): void {
    const h = clamp(dt, 0, 0.05);
    const v = Math.max(0, speed);

    // How far he has turned since last time. A jump is a teleport: the feet go with him.
    const yaw = group.rotation.y;
    let turned = 0;
    if (h > 0 && lastYaw === lastYaw) {
      turned = Math.atan2(Math.sin(yaw - lastYaw), Math.cos(yaw - lastYaw));
      if (Math.abs(turned) > 1.2) turned = 0;
    }
    lastYaw = yaw;

    const push = h > 0 ? clamp((v - prevSpeed) / h, -40, 40) : 0;
    if (h > 0) accel = damp(accel, push, 9, h);
    prevSpeed = v;
    move = damp(move, smoothstep(0.15, 1.4, v), 12, h);
    air = damp(air, grounded ? 0 : 1, 10, h);
    roll = damp(roll, clamp(turnRate * (0.035 + v * 0.011), -0.26, 0.26), 7, h);
    // Setting off throws him forward, pulling up throws him back, and he swings through upright
    // once before he settles. The knees give with it.
    pull(rock, clamp(push * 0.0075, -0.27, 0.2), 110, 10, h);
    const dip = clamp(Math.abs(rock.x) * 0.24, 0, 0.07) * (1 - air);

    // Local slope, so feet and shadow sit on the hill. Rise per metre along his own x and z.
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const gx = clamp(slopeX * cy - slopeZ * sy, -1, 1);
    const gz = clamp(slopeX * sy + slopeZ * cy, -1, 1);
    const climb = Math.atan(-gz); // positive going up

    // The gait for this speed. Three keys: a stroll (1.5 m/s), the walk (6), the run (11.5), and
    // everything between them is a blend, so nothing changes at a threshold.
    // A planted foot travels back at exactly ground speed, so stride length falls out of period and
    // duty: stride = v * period * duty, and a leg can cover about a metre. At 6 m/s that leaves each
    // foot on the ground for a sixth of a second. So the walk is a long gliding stride that stays
    // level, and the run is a different thing: it leans, drives the knees and leaves the ground.
    const k0 = clamp(v / 1.5, 0, 1);
    const kw = clamp((v - 1.5) / 4.5, 0, 1);
    const kr = smoothstep(0, 1, clamp((v - 6) / 5.5, 0, 1));
    // On a hill the steps come quicker and shorter, so the back foot is never left far up or down the slope.
    const hill = 1 / (1 + Math.abs(gz) * 2.2);
    const period = lerp(lerp(0.95, 0.6, kw), 0.43, kr) * hill;
    const duty = lerp(lerp(0.62, 0.262, kw), 0.215, kr);
    const stride = v * period * duty;
    const centre = lerp(lerp(0.03, 0.15, kw), 0.23, kr);
    const strikeZ = centre - stride / 2;
    const liftH = lerp(lerp(0.07, 0.12, kw), 0.27, kr) * (0.4 + 0.6 * hill);
    const heelMax = lerp(lerp(0.5, 0.95, kw), 1.2, kr) * (0.3 + 0.7 * hill);
    const toeUp = lerp(0.32, 0.1, kr) * (1 + clamp(-climb, -0.6, 0.6)); // how far the toes are raised at heel strike
    // Walking he vaults over a straight leg, so he is highest in the middle of a step. Running he
    // sinks onto the leg and springs off it, so he is lowest there.
    const bounceA = lerp(lerp(-0.012, -0.022, kw), 0.055, kr) * hill;
    const hipH = lerp(lerp(lerp(STAND, STAND - 0.012, k0), STAND - 0.022, kw), STAND - 0.03, kr) - Math.abs(gz) * 0.035;
    // Wide enough that a shoe never comes to the middle line.
    const stanceX = lerp(lerp(0.104, 0.092, kw), 0.08, kr);

    // Standing he shuffles his feet to where they belong. Above a slow walk the stride takes over.
    if (!gait && v > 0.9 && grounded) {
      gait = true;
      // Lead with a foot already in the air, or the inside foot of a turn, or the easy leg.
      const first = timed[0] ? 0 : timed[1] ? 1 : Math.abs(turnRate) > 0.6 ? (turnRate > 0 ? 0 : 1) : weight >= 0 ? 0 : 1;
      phase = duty - first * 0.5;
      phase -= Math.floor(phase);
    } else if (gait && v < 0.6) {
      gait = false;
      // A foot caught in the air finishes as a real step, down to where it stands.
      for (let i = 0; i < 2; i++) if (!planted[i] && !timed[i]) startStep(i, 0.17 + liftNow[i] * 0.3, 0.02);
    }
    if (gait) {
      phase += h / period;
      phase -= Math.floor(phase);
    }

    shadow.rotation.set(-Math.atan(gz), 0, Math.atan(gx));
    const sh = 1 - air * 0.3;
    shadow.scale.set(sh, sh, sh * (1.05 + kr * 0.12 * move));

    // Standing: he rests on one leg and changes over every ten seconds, breathes, and between the
    // changes he glances back over a shoulder or rolls his shoulders. He blinks.
    const idle = 1 - move;
    const breath = Math.sin(t * 1.6);
    let stand = 1; // the leg he means to rest on
    let lookIdle = 0;
    let nod = 0;
    let blink = 0;
    let shrugWant = 0;
    if (!calm) {
      const slot = Math.floor(t / 5);
      const ft = t - slot * 5;
      stand = (slot >> 1) & 1 ? -1 : 1;
      const kind = slot & 3;
      const beat = smoothstep(0.9, 1.6, ft) * (1 - smoothstep(3.3, 4.2, ft));
      if (kind === 1) {
        // Over the shoulder: the chest comes round with the head.
        const way = (slot >> 2) & 1 ? 1 : -1;
        lookIdle = beat * way * 1.0;
        nod = beat * 0.05;
      } else if (kind === 3) {
        shrugWant = smoothstep(1.0, 1.5, ft) * (1 - smoothstep(1.9, 2.8, ft));
        nod = -shrugWant * 0.07;
      }
      lookIdle = (lookIdle + Math.sin(t * 0.31) * 0.06) * idle;
      nod = (nod + Math.sin(t * 0.23) * 0.02) * idle;
      const bt = (t + 0.9) % 3.9;
      const b2 = (t + 2.2) % 11.7;
      blink = Math.max(clamp(1 - Math.abs(bt - 0.075) / 0.075, 0, 1), clamp(1 - Math.abs(b2 - 0.075) / 0.075, 0, 1));
      blink = blink * blink * (3 - 2 * blink);
    }
    shrug = damp(shrug, shrugWant * idle, 9, h);

    // Feet, first pass: where each one is on the ground.
    let wantOff = 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const easy = side * stand < 0;
      const hx = homeX(side, easy);
      const hz = homeZ(easy) - v * 0.3; // creeping forward, he reaches ahead
      const hyaw = homeYaw(side, easy);
      let p = phase + i * 0.5;
      p -= Math.floor(p);
      let lift = 0;
      let pitch = 0; // heel up is positive
      let toeHold = 1; // 1 while the toes are pressed flat on the ground

      if (planted[i] && grounded) {
        // The ground goes by under him and he turns over the foot.
        let x = footX[i];
        let z = footZ[i] + v * h;
        if (turned !== 0) {
          const c = Math.cos(turned);
          const s = Math.sin(turned);
          const nx = x * c - z * s;
          z = x * s + z * c;
          x = nx;
          // Past a certain twist the foot swivels on its ball instead of wringing the leg.
          footYaw[i] = clamp(footYaw[i] - turned, -0.68, 0.68);
        }
        footX[i] = x;
        footZ[i] = clamp(z, -0.7, 0.85);
      }

      if (timed[i] && gait && p >= duty) {
        // The stride wants this foot in the air now: the step it was taking becomes the swing.
        timed[i] = false;
        fromX[i] = footX[i];
        fromZ[i] = footZ[i];
        fromYaw[i] = footYaw[i];
        const s0 = (p - duty) / (1 - duty);
        swingAt[i] = s0 < 0.04 ? 0 : s0;
      }
      if (timed[i]) {
        stepS[i] += h / stepT[i];
        const s = Math.min(1, stepS[i]);
        const e = s * s * (3 - 2 * s);
        // In stride the step lands where the gait wants this foot now. Standing, it lands at its place.
        const tx = gait ? side * stanceX : hx;
        const tz = gait ? strikeZ + (stride * p) / duty : hz;
        const tyaw = gait ? -side * 0.06 : hyaw;
        footX[i] = lerp(fromX[i], tx, e);
        footZ[i] = lerp(fromZ[i], tz, e);
        footYaw[i] = lerp(fromYaw[i], tyaw, e);
        lift = fromLift[i] * (1 - e) + stepH[i] * Math.sin(Math.PI * s);
        pitch = 0.5 * Math.sin(Math.PI * s) * (1 - 1.6 * s) + (gait || !easy ? 0 : EASY_PITCH * e);
        toeHold = 1 - smoothstep(0, 0.25, s);
        if (stepS[i] >= 1) {
          timed[i] = false;
          planted[i] = true;
          err[i] = 0;
        }
      } else if (gait) {
        if (p < duty) {
          const u = p / duty;
          // It lands where the swing left it. At a steady pace that is the strike point. When the pace
          // changes mid step it is wherever the foot had got to, so it never jumps.
          planted[i] = true;
          // Heel first, roll flat, then up onto the ball and off the toe.
          pitch = -toeUp * (1 - smoothstep(0, 0.28, u)) + heelMax * smoothstep(0.4, 1, u);
        } else {
          const s0 = (p - duty) / (1 - duty);
          if (planted[i]) {
            planted[i] = false;
            fromX[i] = footX[i];
            fromZ[i] = footZ[i];
            fromYaw[i] = footYaw[i];
            swingAt[i] = s0 < 0.04 ? 0 : s0;
          }
          const at = swingAt[i];
          const s = at > 0 ? clamp((s0 - at) / (1 - at), 0, 1) : s0;
          // At a run the leg trails out behind him first, then the heel comes up and the knee drives through.
          // The foot keeps going back for a moment after it leaves the ground, and is already
          // travelling back again when it comes down, so it neither snaps away nor skids on landing.
          const through = smoothstep(lerp(0, 0.2, kr), 1, s);
          const carry = v * period * (1 - duty) * 0.3 * (1 - at);
          const s2 = s * s;
          footZ[i] = lerp(fromZ[i], strikeZ, through) + carry * (s2 * s - 2 * s2 + s + (s2 * s - s2));
          footX[i] = lerp(fromX[i], side * stanceX, through);
          footYaw[i] = lerp(fromYaw[i], -side * 0.06, through);
          // Up, then down early: the foot is skimming the ground well before it lands.
          lift = liftH * (1 - at * 0.6) * Math.sin(Math.PI * Math.pow(s, lerp(0.8, 0.95, kr))) * (1 - s2 * s2 * s);
          pitch = lerp(heelMax, -toeUp, smoothstep(0.25, 0.92, s)) + Math.sin(Math.PI * s) * 0.4 * kr;
          toeHold = 1 - smoothstep(0, 0.2, s);
        }
      } else {
        // Standing. The easy foot rests on its ball, heel a little off the ground.
        if (!planted[i]) startStep(i, 0.2, 0.03);
        pitch = easy ? EASY_PITCH * idle : 0;
        err[i] = Math.hypot(footX[i] - hx, footZ[i] - hz) + Math.abs(footYaw[i] - hyaw) * 0.14;
      }
      // A foot never comes to the middle line, whatever the turn has done to it.
      if (side * footX[i] < 0.062) footX[i] = side * 0.062;

      let fx = footX[i];
      let fz = footZ[i];
      if (h > 0) {
        liftNow[i] = damp(liftNow[i], lift, 90, h);
        pitchNow[i] = damp(pitchNow[i], pitch, 70, h);
      }
      lift = liftNow[i];
      pitch = pitchNow[i];
      // In the air both legs tuck, one a little ahead of the other.
      fx = lerp(fx, side * 0.1, air);
      fz = lerp(fz, side * 0.14, air);
      lift = lerp(lift, 0.14 - side * 0.05, air);
      pitch = lerp(pitch, 0.5, air);

      // Ground under this foot, and the tilt of the sole to match it.
      const ground = clamp(gx * fx + gz * fz, -0.35, 0.35) * (1 - air);
      pitch += Math.atan(gz) * 0.85 * (1 - air);

      // Ankle from the contact point: rock over the ball of the foot, or back on the heel.
      const c = Math.cos(pitch);
      const s2 = Math.sin(pitch);
      if (pitch >= 0) {
        solY[i] = ground + lift + ANKLE * c + BALL * s2;
        solZ[i] = fz - BALL + BALL * c - ANKLE * s2;
      } else {
        solY[i] = ground + lift + ANKLE * c - HEEL * s2;
        solZ[i] = fz + HEEL - ANKLE * s2 - HEEL * c;
      }
      solX[i] = fx;
      solPitch[i] = pitch;
      solToe[i] = toeHold;
    }

    // Standing: a foot that is out of place takes a step to put it right. One at a time, the one
    // with less weight on it first. A foot he is leaning on waits until the weight has come off it.
    const down0 = planted[0] || (timed[0] && stepS[0] > 0.6);
    const down1 = planted[1] || (timed[1] && stepS[1] > 0.6);
    if (!gait && grounded && down0 && down1 && (planted[0] || planted[1]) && h > 0) {
      const lighter = !planted[0] ? 1 : !planted[1] ? 0 : err[0] + weight * 0.04 > err[1] - weight * 0.04 ? 0 : 1;
      const side = lighter === 0 ? -1 : 1;
      const e = err[lighter];
      if (e > 0.05 + v * 0.2) {
        if (side * weight > 0.2 && e < 0.3) wantOff = -side;
        else startStep(lighter, clamp(0.17 + e * 0.35, 0.18, 0.3), clamp(0.025 + e * 0.22, 0.035, 0.1));
      }
    }
    {
      // Weight goes to the leg he rests on, and off any foot that is in the air or wants to move.
      let want = stand;
      if (wantOff !== 0) want = wantOff;
      if (!gait && timed[0] !== timed[1]) want = timed[0] ? 1 : -1;
      weight = damp(weight, gait ? 0 : want * idle, gait ? 10 : 3.2, h);
    }

    // Pelvis.
    const st = phase - duty / 2;
    const beat = Math.cos(2 * TAU * st); // +1 at the middle of each foot's stance
    const side0 = Math.cos(TAU * st); // +1 when the left foot carries him
    const lead = Math.cos(TAU * phase + 0.2); // +1 when the left leg is forward
    const stridden = gait ? move : move * 0.25; // how much of the stride's sway the body carries
    const px = weight * 0.042 - side0 * 0.02 * stridden * (1 - kr * 0.4);
    let py = lerp(STAND + 0.007 - Math.abs(weight) * 0.012 + breath * 0.0015, hipH - bounceA * beat, move) - dip + air * 0.04;
    const twist = -lead * lerp(0.1, 0.17, kr) * stridden + weight * 0.07;
    const tip = weight * 0.105 - side0 * lerp(0.055, 0.035, kr) * stridden; // the hip over the standing leg rides high
    // He leans with his speed, into a climb, back on the way down, and rocks with every start and stop.
    const lean = lerp(0, lerp(0.02, lerp(0.07, 0.3, kr), kw), move) + rock.x + climb * (climb > 0 ? 0.32 : 0.22) * move;
    // Standing, his hips sit over his ankles: ear, shoulder, hip and the front of the ankle in one line.
    const pz = STAND_Z - 0.03 * idle;
    const cr = Math.cos(tip);
    const sr = Math.sin(tip);
    const ct = Math.cos(twist);
    const sn = Math.sin(twist);
    // He cannot stand taller than his planted legs reach. A wide stance after a stop sinks him a
    // little, and he comes up again as the feet come in.
    let need = 0;
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const ox = side * HIP_W * cr + HIP_DROP * sr;
      const oy = side * HIP_W * sr - HIP_DROP * cr;
      const dx = solX[i] - (px + ox * ct);
      const dz = solZ[i] - (pz - ox * sn);
      const top = solY[i] + Math.sqrt(Math.max(0.09, LEG_MAX * LEG_MAX - dx * dx - dz * dz)) - oy + liftNow[i] * 4;
      if (py - top > need) need = py - top;
    }
    sink = damp(sink, clamp(need, 0, 0.13) * idle, 16, h);
    py -= sink;
    pelvis.position.set(px, py, pz);
    pelvis.rotation.set(-lean * 0.38 - 0.05 * idle, twist, tip);
    body.rotation.z = roll * 0.55;

    // Spine and head. Shoulders turn against the hips and tilt against them, and the head undoes
    // most of both, so it rides level and keeps looking where he is going.
    const look = clamp(turnRate * 0.1, -0.35, 0.35) + lookIdle;
    const chestRoll = roll * 0.5 - tip * 1.4;
    torso.rotation.set(-lean * 0.62 - (0.05 + breath * 0.012) * idle + shrug * 0.06, -twist * 1.9 + look * 0.32, chestRoll);
    torso.position.y = SPINE_UP + breath * 0.0025 + shrug * 0.008;
    head.mesh.rotation.set(lean * lerp(0.78, 0.52, kr * move) - 0.02 + 0.07 * idle + nod, twist * 0.86 + look * 0.68, -roll * 0.6 + tip * 0.36);
    head.mesh.position.y = NECK_UP + bounceA * beat * 0.3 * move - shrug * 0.006;
    lagY = damp(lagY, py, 16, h);
    const drop = lagY - py; // positive while he is on his way down

    // The bunch: two springs about the tie. It lies back with speed, is left behind when he sets
    // off, flicks forward when he stops, nods a beat behind each footfall, and is thrown to the
    // outside of a turn. Half the twists follow a beat behind the other half, and each one bends
    // more toward its tip. With h at zero nothing moves, so a frozen frame keeps whatever swing it had.
    {
      const wantP = (0.1 + 0.2 * kr) * move + clamp(accel * 0.022, -0.2, 0.3) - clamp(drop * 8, -0.2, 0.2) - air * 0.12;
      const wantS = clamp(turnRate * (0.05 + v * 0.008), -0.3, 0.3) - Math.cos(TAU * st - 0.6) * lerp(0.05, 0.09, kr) * stridden + weight * 0.03;
      pull(tailP, wantP, 150, 9, h);
      pull(tailS, wantS, 150, 9, h);
      // At the stops the swing is spent, or it would buzz against them.
      if (tailP.x > LEAN_BACK) {
        tailP.x = LEAN_BACK;
        if (tailP.v > 0) tailP.v = 0;
      } else if (tailP.x < -LEAN_FWD) {
        tailP.x = -LEAN_FWD;
        if (tailP.v < 0) tailP.v = 0;
      }
      if (tailS.x > LEAN_SIDE) {
        tailS.x = LEAN_SIDE;
        if (tailS.v > 0) tailS.v = 0;
      } else if (tailS.x < -LEAN_SIDE) {
        tailS.x = -LEAN_SIDE;
        if (tailS.v < 0) tailS.v = 0;
      }
      topP = damp(topP, clamp(tailP.x * 1.25, -LEAN_FWD, LEAN_BACK), 11, h);
      topS = damp(topS, clamp(tailS.x * 1.25, -LEAN_SIDE, LEAN_SIDE), 11, h);
      tail.setFrame(TAIL_FRAMES.a, turnAbout(m1, 0, 0, 0, tailP.x, 0, -tailS.x));
      tail.setFrame(TAIL_FRAMES.b, turnAbout(m1, 0, 0, 0, topP, 0, -topS));
      tail.apply();
    }

    // The pouch on his back: lifts off a little after each footfall and slides along the strap.
    // It only ever swings away from him.
    {
      const wantL = (0.03 + 0.12 * kr) * stridden * (0.5 - 0.5 * Math.cos(2 * TAU * st - 1.3)) + clamp(Math.abs(turnRate) * 0.02, 0, 0.1) + air * 0.22 + clamp(-accel * 0.006, 0, 0.12);
      const wantS = Math.cos(TAU * st - 0.9) * lerp(0.04, 0.1, kr) * stridden + clamp(turnRate * 0.03, -0.14, 0.14);
      pull(bagL, wantL, 140, 8, h);
      pull(bagS, wantS, 140, 8, h);
      if (bagL.x < 0) {
        bagL.x = 0;
        if (bagL.v < 0) bagL.v = 0;
      }
      bag.quaternion.copy(chest.bagTurn).multiply(qa.setFromEuler(ea.set(-Math.min(bagL.x, 0.5), 0, clamp(bagS.x, -0.3, 0.3))));
    }

    // Arms swing against the legs, along his sides. Easy at a walk, elbows soft. At a run they fold
    // and pump: the forward hand comes up to the chest and no higher, the back hand passes the hip.
    // Standing, the right arm hangs easy and the gloved left hand sits hooked at his pocket.
    const swing = Math.cos(TAU * phase + 0.35);
    const late = Math.cos(TAU * phase + 0.35 - 0.9);
    const armA = lerp(lerp(0.25, 0.5, kw), 0.6, kr) * stridden;
    const fold = lerp(lerp(0.3, 0.38, kw), 1.55, kr * kr);
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const s = side * swing; // right arm forward with the left leg
      const a = arm[i];
      const hook = i === 0 ? idle : 0;
      const rest = idle - hook;
      a.mesh.rotation.set(
        armA * s - 0.07 * move - 0.02 * rest - 0.52 * hook - lean * 0.25 + air * 0.3 - shrug * 0.1,
        side * ((0.24 - 0.3 * kr) * move + 0.16 * rest + 0.62 * hook),
        side * (0.1 + 0.03 * rest + 0.3 * hook + 0.03 * kr * move + breath * 0.008 * idle + air * 0.5 + shrug * 0.07) + tip * 0.85,
      );
      const bend = (fold + (s > 0 ? s * lerp(0.42, 0.3, kr) : s * lerp(0.12, 0.3, kr))) * move + 0.3 * rest + 1.5 * hook;
      turnAbout(m1, 0, -UPPER_ARM, 0, bend, 0, 0);
      a.setFrame(ARM_FRAMES.fore, m1);
      // The hand trails the forearm a little. Hooked at the pocket it hangs from the wrist.
      turnAbout(m2, 0, -WRIST, 0, lerp(0.12, 0.02, kr * move) * (1 - hook) - 0.85 * hook + side * late * 0.2 * stridden, 0, side * (0.06 + 0.2 * hook));
      a.setFrame(ARM_FRAMES.hand, m2.premultiply(m1));
      a.apply();
    }

    // Legs: solve hip, knee and ankle to reach each foot. The knee points part of the way the toes do.
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? -1 : 1;
      const pitch = solPitch[i];
      const fyaw = footYaw[i] * (1 - air);
      const tau = clamp(fyaw * 0.6, -0.5, 0.5);
      const cta = Math.cos(tau);
      const sta = Math.sin(tau);

      // Hip joint, carried by the pelvis roll and twist.
      const ox = side * HIP_W * cr + HIP_DROP * sr;
      const oy = side * HIP_W * sr - HIP_DROP * cr;
      const hx = px + ox * ct;
      const hy = py + oy;
      const hz = pz - ox * sn;

      const wx = solX[i] - hx;
      const dy = solY[i] - hy;
      const wz = solZ[i] - hz;
      const dx = wx * cta - wz * sta;
      const dz = wx * sta + wz * cta;
      const lat = Math.atan2(dx, -dy);
      const down = Math.hypot(dx, dy);
      const d = clamp(Math.hypot(down, dz), 0.3, REACH);
      const dir = Math.atan2(-dz, down);
      const alpha = Math.acos(clamp((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d), -1, 1));
      const bend = Math.PI - Math.acos(clamp((THIGH * THIGH + SHIN * SHIN - d * d) / (2 * THIGH * SHIN), -1, 1));
      const l = leg[i];
      l.mesh.position.set(hx, hy, hz);
      l.mesh.rotation.set(dir + alpha, tau, lat);
      flex[i] = dir + alpha;
      knee[i].rotation.x = -bend;
      turnAbout(m1, 0, -THIGH, 0, -bend, 0, 0);
      l.setFrame(LEG_FRAMES.shin, m1);
      l.apply();
      // The shoe: undo the leg, then lay the sole on the ground the way the foot points.
      const f = foot[i];
      qa.setFromAxisAngle(AX, bend - (dir + alpha));
      qa.multiply(qb.setFromAxisAngle(AZ, -lat));
      qa.multiply(qb.setFromAxisAngle(AY, fyaw - tau));
      qa.multiply(qb.setFromAxisAngle(AZ, Math.atan(gx) * 0.85 * (1 - air)));
      qa.multiply(qb.setFromAxisAngle(AX, -pitch));
      f.mesh.quaternion.copy(qa);
      // The front of the shoe stays flat on the ground while the heel peels up.
      turnAbout(m1, 0, -ANKLE, -BALL, clamp(pitch, 0, 0.95) * solToe[i], 0, 0);
      f.setFrame(FOOT_FRAMES.toe, m1);
      f.apply();
    }

    // Hips: the top of the tee goes with the chest, the hem goes with the thighs and swings a
    // little behind everything, and the strap off his belt hangs and follows his left leg.
    {
      torso.updateMatrix();
      hips.setFrame(HIP_FRAMES.chest, torso.matrix, 0, SPINE_UP, 0);
      pull(hemX, clamp(-accel * 0.005, -0.07, 0.07) + 0.03 * beat * kr * stridden, 110, 9, h);
      pull(hemY, -twist * 0.45, 110, 9, h);
      pull(hemZ, side0 * 0.05 * stridden - weight * 0.02 + clamp(turnRate * 0.02, -0.08, 0.08), 110, 9, h);
      hips.setFrame(HIP_FRAMES.sway, turnAbout(m1, 0, WAIST, 0, hemX.x, hemY.x, hemZ.x));
      const fl = flex[0] + lean * 0.3;
      const fr = flex[1] + lean * 0.3;
      hips.setFrame(HIP_FRAMES.frontL, turnAbout(m1, -HIP_W, -HIP_DROP, 0, clamp(fl * 0.7, 0, 1.0), 0, 0));
      hips.setFrame(HIP_FRAMES.frontR, turnAbout(m1, HIP_W, -HIP_DROP, 0, clamp(fr * 0.7, 0, 1.0), 0, 0));
      hips.setFrame(HIP_FRAMES.backL, turnAbout(m1, -HIP_W, -HIP_DROP, 0, clamp(fl, -0.8, 0), 0, 0));
      hips.setFrame(HIP_FRAMES.backR, turnAbout(m1, HIP_W, -HIP_DROP, 0, clamp(fr, -0.8, 0), 0, 0));
      pull(webX, flex[0] * 0.55 + lean * 0.3, 70, 5, h);
      pull(webZ, (0.03 + 0.1 * kr) * move + clamp(Math.abs(turnRate) * 0.03, 0, 0.12) + air * 0.2, 70, 5, h);
      hips.setFrame(HIP_FRAMES.strap, turnAbout(m1, STRAP_AT[0], STRAP_AT[1], STRAP_AT[2], clamp(webX.x, -0.6, 1.0), 0, -Math.max(0, webZ.x)));
      hips.apply();
    }

    // Eyes. Only touched when the lids move.
    if (blink !== lastBlink) {
      lastBlink = blink;
      head.setFrame(HEAD_FRAMES.lids, m1.makeTranslation(0, -LID_DROP * blink, 0));
      head.apply();
    }
  }

  reset();
  update(0, 0, 0, 0, true);

  const height = STAND + SPINE_UP + NECK_UP + (CROWN + hs.rowH) * HEAD_SCALE;
  return { group, update, height, setSlope, reset, setCalm };
}

/** How many triangles and meshes he costs. For the test page. */
export function characterCost(c: Character): { meshes: number; triangles: number } {
  let meshes = 0;
  let triangles = 0;
  c.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    meshes++;
    const g = m.geometry;
    triangles += (g.index ? g.index.count : g.getAttribute('position').count) / 3;
  });
  return { meshes, triangles };
}
