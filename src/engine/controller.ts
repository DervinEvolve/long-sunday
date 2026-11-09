// Moves the visitor over the ground and keeps the camera behind him.
// Kinematic: no physics engine. He sticks to heightAt, slides along colliders and the world rim,
// and steep ground turns him aside. The camera is a spring arm with its own small rules.
//
// Headings follow src/world/layout.ts: forward = (-sin yaw, 0, -cos yaw), yaw 0 looks north (-z).
// A box collider's `rot` is a turn about y the same way three's rotation.y goes.
import * as THREE from 'three';
import type { Collider } from '../types';
import type { Input } from './input';
import { angleDelta, clamp, damp, dampAngle, lerp, smoothstep, wrapAngle } from './util';

export type WorldCollider = Collider; // world space

export interface ControllerOpts {
  camera: THREE.PerspectiveCamera;
  input: Input;
  heightAt(x: number, z: number): number;
  inBounds(x: number, z: number): boolean;
  /** World-space colliders near the player. May change between frames. */
  colliders(): readonly Collider[];
}

export interface Controller {
  position: THREE.Vector3;
  yaw: number;
  /** Metres per second over the ground, after collisions. Feed it to the figure. */
  speed: number;
  /** Radians per second, positive when yaw is going up (a left turn). */
  turnRate: number;
  cameraYaw: number;
  /** False while he is dropping off a ledge. */
  grounded: boolean;
  /** Ground slope under him: rise per metre east and per metre south. For Character.setSlope. */
  slopeX: number;
  slopeZ: number;
  update(dt: number): void;
  /** Snaps the camera too. */
  teleport(x: number, z: number, yaw?: number): void;
  setAspect(aspect: number): void;
  /** Title mode: he stands still and the camera drifts in a slow arc in front of him. */
  frameFor(mode: 'play' | 'title'): void;
}

// Tuning. Speeds in m/s, rates per second.
const WALK = 6;
const RUN = 11.5;
const ACCEL = 30;
const BRAKE = 38;
const TURN = 13; // how fast he swings round to face his travel
const RADIUS = 0.36; // his footprint
const MAX_STEP = 0.22; // longest move between collision checks
const MAX_DT = 0.05;
const STEEP_FROM = 0.62; // tan of the slope where he starts to lose his footing (about 32 degrees)
const STEEP_FULL = 0.9; // and where he cannot climb at all (about 42)
const GRAVITY = 32;

const FOV = 55;
const DIST = 6.6;
const DIST_MIN = 3;
const DIST_MAX = 15;
const PITCH = 0.13; // camera elevation above his shoulders, radians
const PITCH_MIN = -0.3;
const PITCH_MAX = 1.15;
const PIVOT_UP = 1.5;
const AIM_UP = 0.205; // look this far above the pivot per metre of arm: puts him low in the frame
const CLEAR = 0.45; // camera stays this far above the ground
const RECENTRE_AFTER = 2; // seconds of walking without a drag before the camera drifts behind him
const NEAR_ARM = 1.3;

export function createController(opts: ControllerOpts): Controller {
  const { camera, input, heightAt, inBounds } = opts;

  const position = new THREE.Vector3();
  let vx = 0;
  let vz = 0;
  let vy = 0;
  let aspect = camera.aspect || 1.6;
  let mode: 'play' | 'title' = 'play';

  // Camera state. Targets are what the visitor asked for, the rest chase them.
  let yawTarget = 0;
  let pitchTarget = PITCH;
  let distTarget = DIST;
  let camYaw = 0;
  let camPitch = PITCH;
  let camDist = DIST;
  let pivotY = 0;
  let lift = 0; // extra height to clear a hill
  let block = DIST_MAX; // arm length allowed by colliders
  let sinceLook = 0; // seconds walked since the last drag; runs down again while he stands
  let title = 0; // 0 play rig, 1 title rig
  let titleClock = 0;
  let portrait = 0;

  const c: Controller = {
    position,
    yaw: 0,
    speed: 0,
    turnRate: 0,
    cameraYaw: 0,
    grounded: true,
    slopeX: 0,
    slopeZ: 0,
    update,
    teleport,
    setAspect,
    frameFor,
  };

  // -------------------------------------------------------------------------------------------
  // Colliders
  // -------------------------------------------------------------------------------------------

  // Push the point (px, pz) out of one collider. Writes outX/outZ and the push direction nX/nZ.
  let outX = 0;
  let outZ = 0;
  let nX = 0;
  let nZ = 0;
  function pushOut(col: Collider, px: number, pz: number): boolean {
    if (col.kind === 'circle') {
      const dx = px - col.x;
      const dz = pz - col.z;
      const reach = col.r + RADIUS;
      const d2 = dx * dx + dz * dz;
      if (d2 >= reach * reach) return false;
      const d = Math.sqrt(d2);
      if (d < 1e-5) {
        nX = 1;
        nZ = 0;
      } else {
        nX = dx / d;
        nZ = dz / d;
      }
      outX = col.x + nX * reach;
      outZ = col.z + nZ * reach;
      return true;
    }
    const rot = col.rot ?? 0;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const dx = px - col.x;
    const dz = pz - col.z;
    // Into the box's own axes.
    const lx = dx * cs - dz * sn;
    const lz = dx * sn + dz * cs;
    const qx = clamp(lx, -col.hw, col.hw);
    const qz = clamp(lz, -col.hd, col.hd);
    let ex = lx - qx;
    let ez = lz - qz;
    const d2 = ex * ex + ez * ez;
    let rx: number;
    let rz: number;
    if (d2 > 1e-10) {
      // Centre is outside the box: push away from the nearest point on it.
      if (d2 >= RADIUS * RADIUS) return false;
      const d = Math.sqrt(d2);
      ex /= d;
      ez /= d;
      rx = qx + ex * RADIUS;
      rz = qz + ez * RADIUS;
    } else {
      // Centre is inside: leave by the nearest face.
      const toX = col.hw - Math.abs(lx);
      const toZ = col.hd - Math.abs(lz);
      if (toX < toZ) {
        ex = lx < 0 ? -1 : 1;
        ez = 0;
        rx = ex * (col.hw + RADIUS);
        rz = lz;
      } else {
        ex = 0;
        ez = lz < 0 ? -1 : 1;
        rx = lx;
        rz = ez * (col.hd + RADIUS);
      }
    }
    // Back to the world.
    outX = col.x + rx * cs + rz * sn;
    outZ = col.z - rx * sn + rz * cs;
    nX = ex * cs + ez * sn;
    nZ = -ex * sn + ez * cs;
    return true;
  }

  // Where a ray from (ox, oz) along the unit direction (dx, dz) first enters a collider. Infinity if never.
  function rayHit(col: Collider, ox: number, oz: number, dx: number, dz: number, pad: number): number {
    if (col.kind === 'circle') {
      if (col.r < 0.5) return Infinity; // posts and small props do not crowd the camera
      const r = col.r + pad;
      const mx = ox - col.x;
      const mz = oz - col.z;
      const b = mx * dx + mz * dz;
      const cc = mx * mx + mz * mz - r * r;
      if (cc <= 0) return 0;
      const disc = b * b - cc;
      if (disc < 0 || b > 0) return Infinity;
      return -b - Math.sqrt(disc);
    }
    if (Math.max(col.hw, col.hd) < 0.5) return Infinity;
    const rot = col.rot ?? 0;
    const cs = Math.cos(rot);
    const sn = Math.sin(rot);
    const mx = ox - col.x;
    const mz = oz - col.z;
    const lx = mx * cs - mz * sn;
    const lz = mx * sn + mz * cs;
    const ldx = dx * cs - dz * sn;
    const ldz = dx * sn + dz * cs;
    const hw = col.hw + pad;
    const hd = col.hd + pad;
    let t0 = 0;
    let t1 = Infinity;
    if (Math.abs(ldx) < 1e-6) {
      if (Math.abs(lx) > hw) return Infinity;
    } else {
      const a = (-hw - lx) / ldx;
      const b = (hw - lx) / ldx;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    if (Math.abs(ldz) < 1e-6) {
      if (Math.abs(lz) > hd) return Infinity;
    } else {
      const a = (-hd - lz) / ldz;
      const b = (hd - lz) / ldz;
      t0 = Math.max(t0, Math.min(a, b));
      t1 = Math.min(t1, Math.max(a, b));
    }
    return t0 <= t1 ? t0 : Infinity;
  }

  // -------------------------------------------------------------------------------------------
  // Walking
  // -------------------------------------------------------------------------------------------

  function walk(dt: number): void {
    const s = input.state;
    let mx = mode === 'play' ? s.moveX : 0;
    let my = mode === 'play' ? s.moveY : 0;
    const mag = Math.hypot(mx, my);
    if (mag > 1) {
      mx /= mag;
      my /= mag;
    }

    // Camera-relative: forward on the stick is away from the camera.
    const sy = Math.sin(camYaw);
    const cy = Math.cos(camYaw);
    const top = s.run ? RUN : WALK;
    let wantX = (-sy * my + cy * mx) * top;
    let wantZ = (-cy * my - sy * mx) * top;

    // Ground slope here. Steep ground takes away the uphill part of what he wants, so he drifts along
    // the foot of a cliff the way he slides along a wall.
    const e = 0.45;
    const gx = (heightAt(position.x + e, position.z) - heightAt(position.x - e, position.z)) / (2 * e);
    const gz = (heightAt(position.x, position.z + e) - heightAt(position.x, position.z - e)) / (2 * e);
    c.slopeX = damp(c.slopeX, gx, 14, dt);
    c.slopeZ = damp(c.slopeZ, gz, 14, dt);
    const steep = Math.hypot(gx, gz);
    const refuse = smoothstep(STEEP_FROM, STEEP_FULL, steep);
    if (refuse > 0) {
      const ux = gx / steep;
      const uz = gz / steep;
      const up = wantX * ux + wantZ * uz;
      if (up > 0) {
        wantX -= ux * up * refuse;
        wantZ -= uz * up * refuse;
      }
      const going = vx * ux + vz * uz;
      if (going > 0) {
        const cut = Math.min(1, refuse * dt * 14);
        vx -= ux * going * cut;
        vz -= uz * going * cut;
      }
    }

    // Ease the velocity toward what he wants. Braking is a little harder than starting.
    const ddx = wantX - vx;
    const ddz = wantZ - vz;
    const dd = Math.hypot(ddx, ddz);
    if (dd > 1e-6) {
      const speeding = wantX * wantX + wantZ * wantZ > vx * vx + vz * vz;
      const step = Math.min(dd, (speeding ? ACCEL : BRAKE) * dt);
      vx += (ddx / dd) * step;
      vz += (ddz / dd) * step;
    }

    // Move in short steps so a long frame cannot carry him through a wall.
    const cols = opts.colliders();
    const dist = Math.hypot(vx, vz) * dt;
    const steps = Math.max(1, Math.ceil(dist / MAX_STEP));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      let x = position.x + vx * h;
      let z = position.z + vz * h;

      for (let pass = 0; pass < 2; pass++) {
        let touched = false;
        for (let k = 0; k < cols.length; k++) {
          if (!pushOut(cols[k], x, z)) continue;
          touched = true;
          x = outX;
          z = outZ;
          const into = vx * nX + vz * nZ;
          if (into < 0) {
            vx -= nX * into;
            vz -= nZ * into;
          }
        }
        if (!touched) break;
      }

      // The rim of the world. Feel for which way is inside and slide along the edge.
      if (!inBounds(x, z)) {
        let ix = 0;
        let iz = 0;
        for (let k = 0; k < 16; k++) {
          const a = k * (Math.PI / 8);
          const px = Math.cos(a);
          const pz = Math.sin(a);
          if (inBounds(position.x + px * 0.8, position.z + pz * 0.8)) {
            ix += px;
            iz += pz;
          }
        }
        const il = Math.hypot(ix, iz);
        let ok = false;
        if (il > 1e-3) {
          ix /= il;
          iz /= il;
          const out = (x - position.x) * ix + (z - position.z) * iz;
          if (out < 0) {
            x -= ix * out;
            z -= iz * out;
          }
          const into = vx * ix + vz * iz;
          if (into < 0) {
            vx -= ix * into;
            vz -= iz * into;
          }
          // A curved rim falls away from the tangent and the feel for the normal is coarse, so
          // edge back inside a centimetre at a time.
          for (let k = 0; k < 16 && !inBounds(x, z); k++) {
            x += ix * 0.01;
            z += iz * 0.01;
          }
          ok = inBounds(x, z);
        }
        if (!ok) {
          x = position.x;
          z = position.z;
          vx = 0;
          vz = 0;
        }
      }

      position.x = x;
      position.z = z;

      // Stick to the ground on anything walkable. Off a real ledge he drops.
      const ground = heightAt(x, z);
      const gap = position.y - ground;
      if (gap <= 0.3 + Math.hypot(vx, vz) * h * 1.3 && vy <= 0) {
        position.y = ground;
        vy = 0;
        c.grounded = true;
      } else {
        vy -= GRAVITY * h;
        position.y += vy * h;
        c.grounded = false;
        if (position.y <= ground) {
          position.y = ground;
          vy = 0;
          c.grounded = true;
        }
      }
    }

    // Face the way he is going, and report how fast he is turning.
    const speed = Math.hypot(vx, vz);
    const before = c.yaw;
    if (speed > 0.35) {
      const heading = Math.atan2(-vx, -vz);
      c.yaw = wrapAngle(dampAngle(c.yaw, heading, TURN * smoothstep(0.35, 2, speed), dt));
    }
    c.turnRate = damp(c.turnRate, angleDelta(before, c.yaw) / dt, 12, dt);
    c.speed = speed < 0.02 ? 0 : speed;
  }

  // -------------------------------------------------------------------------------------------
  // Camera
  // -------------------------------------------------------------------------------------------

  function look(dt: number, snap: boolean): void {
    const s = input.state;
    if (mode === 'play') {
      if (s.lookDX !== 0 || s.lookDY !== 0) {
        yawTarget -= s.lookDX;
        pitchTarget = clamp(pitchTarget + s.lookDY, PITCH_MIN, PITCH_MAX);
        sinceLook = 0;
      } else if (c.speed > 1.2) {
        sinceLook = Math.min(sinceLook + dt, RECENTRE_AFTER + 2);
      } else {
        sinceLook = Math.max(0, sinceLook - dt * 3);
      }
      if (s.zoom !== 0) distTarget = clamp(distTarget * Math.exp(s.zoom * 0.13), DIST_MIN, DIST_MAX);

      // Drift back behind him once he has walked a while without a drag. Not when he is coming
      // toward the camera: turning then would spin the stick directions under the visitor's thumb.
      // The rate goes with his speed, so holding sideways walks a circle about as wide as the arm
      // is long at any pace, which is what a camera that only watched him would do.
      if (sinceLook > RECENTRE_AFTER && c.speed > 1.2) {
        const off = angleDelta(yawTarget, c.yaw);
        const side = smoothstep(-0.75, -0.2, Math.cos(off));
        const ease = smoothstep(RECENTRE_AFTER, RECENTRE_AFTER + 1.2, sinceLook);
        yawTarget += off * (1 - Math.exp(-0.55 * (c.speed / WALK) * side * ease * dt));
        pitchTarget = damp(pitchTarget, PITCH, 0.7 * ease, dt);
      }
    }

    const k = snap ? 1 : 0;
    camYaw = snap ? yawTarget : dampAngle(camYaw, yawTarget, 24, dt);
    camPitch = damp(camPitch, pitchTarget, k ? 1e6 : 24, dt);
    const far = distTarget * (1 - portrait * 0.1) + smoothstep(WALK + 1, RUN, c.speed) * 0.7;
    camDist = damp(camDist, far, k ? 1e6 : 6, dt);
    pivotY = damp(pivotY, position.y + PIVOT_UP, k ? 1e6 : c.grounded ? 12 : 20, dt);
    // Never let the pivot drift far from him on a fast climb or drop.
    pivotY = clamp(pivotY, position.y + PIVOT_UP - 0.9, position.y + PIVOT_UP + 0.9);

    // The follow rig: behind and above, looking over his head so he sits low and the sky is big.
    const fx = -Math.sin(camYaw);
    const fz = -Math.cos(camYaw);
    const bx = -fx; // from him back toward the camera
    const bz = -fz;
    const cp = Math.cos(camPitch);
    const sp = Math.sin(camPitch);

    // Colliders between him and the camera pull the arm in. In fast, out slow.
    let allowed = DIST_MAX + 2;
    const cols = opts.colliders();
    const flat = camDist * cp;
    for (let i = 0; i < cols.length; i++) {
      const t = rayHit(cols[i], position.x, position.z, bx, bz, 0.3);
      if (t < flat) allowed = Math.min(allowed, Math.max(NEAR_ARM, t / Math.max(cp, 0.2) - 0.15));
    }
    // Ground rising behind him: a bank just lifts the camera (below), a wall of it pulls the arm in,
    // or the camera would climb the wall and look straight down on him.
    let e0 = -1;
    for (let i = 1; i <= 6; i++) {
      const d = (camDist * i) / 6;
      const gy = heightAt(position.x + bx * d * cp, position.z + bz * d * cp) + CLEAR;
      const e1 = gy - (pivotY + d * sp) - (0.9 + d * 0.22);
      if (e1 > 0) {
        const d0 = (camDist * (i - 1)) / 6;
        const cross = d0 + ((d - d0) * -e0) / (e1 - e0);
        allowed = Math.min(allowed, Math.max(NEAR_ARM, cross));
        break;
      }
      e0 = e1;
    }
    block = snap ? allowed : damp(block, allowed, allowed < block ? 22 : 3.5, dt);
    const arm = Math.min(camDist, block);

    let px = position.x + bx * arm * cp;
    let pz = position.z + bz * arm * cp;
    let py = pivotY + arm * sp;

    // Keep the whole arm above the ground: raise the far end until every sample along it clears.
    let need = 0;
    for (let i = 1; i <= 4; i++) {
      const f = i / 4;
      const gy = heightAt(position.x + (px - position.x) * f, position.z + (pz - position.z) * f) + CLEAR * (0.4 + 0.6 * f);
      const ay = pivotY + (py - pivotY) * f;
      if (gy > ay) need = Math.max(need, (gy - ay) / f);
    }
    lift = snap ? need : damp(lift, need, need > lift ? 20 : 3, dt);
    py += lift;
    // Whatever the smoothing says, the lens itself is never under the ground.
    const floor = heightAt(px, pz) + CLEAR * 0.7;
    if (py < floor) py = floor;

    let ax = position.x;
    // From a low camera the same aim would push his feet off the bottom of the frame.
    const low = lerp(0.5, 1, smoothstep(PITCH_MIN, PITCH, camPitch));
    let ay = pivotY + arm * AIM_UP * low * lerp(1, 0.82, portrait) + lift * 0.35;
    let az = position.z;

    // The title rig: in front of him, a little below eye level, drifting from side to side.
    title = snap ? (mode === 'title' ? 1 : 0) : damp(title, mode === 'title' ? 1 : 0, 2.6, dt);
    if (title > 0.001) {
      titleClock += dt;
      const a = c.yaw + Math.sin(titleClock * 0.21) * 0.6 + 0.28;
      const td = lerp(4.2, 6, portrait);
      let tx = position.x - Math.sin(a) * td;
      let tz = position.z - Math.cos(a) * td;
      let ty = position.y + 1.25 + Math.sin(titleClock * 0.13) * 0.12;
      ty = Math.max(ty, heightAt(tx, tz) + CLEAR);
      const tay = position.y + 1.5;
      const w = title * title * (3 - 2 * title);
      // Swing round him instead of cutting through him: blend the angle and the distance, not the points.
      if (w < 0.999) {
        const a0 = Math.atan2(px - position.x, pz - position.z);
        const a1 = Math.atan2(tx - position.x, tz - position.z);
        const d0 = Math.hypot(px - position.x, pz - position.z);
        const aa = a0 + angleDelta(a0, a1) * w;
        const dm = lerp(d0, td, w);
        tx = position.x + Math.sin(aa) * dm;
        tz = position.z + Math.cos(aa) * dm;
        ty = lerp(py, ty, w);
      }
      px = tx;
      pz = tz;
      py = ty;
      ax = position.x;
      ay = lerp(ay, tay, w);
      az = position.z;
    }

    camera.position.set(px, py, pz);
    camera.lookAt(ax, ay, az);
    c.cameraYaw = camYaw;
  }

  function update(dt: number): void {
    const h = clamp(dt, 0, MAX_DT);
    if (h <= 0) {
      look(0, false);
      return;
    }
    walk(h);
    look(h, false);
  }

  function teleport(x: number, z: number, yaw?: number): void {
    position.set(x, heightAt(x, z), z);
    vx = vz = vy = 0;
    if (yaw !== undefined) c.yaw = wrapAngle(yaw);
    c.speed = 0;
    c.turnRate = 0;
    c.grounded = true;
    c.slopeX = 0;
    c.slopeZ = 0;
    yawTarget = c.yaw;
    pitchTarget = PITCH;
    sinceLook = 0;
    look(0, true);
  }

  function setAspect(a: number): void {
    aspect = a > 0 ? a : 1;
    // Landscape keeps 55 degrees top to bottom. A tall phone would see a slit of the world at that,
    // so open the lens until the view is at least 44 degrees side to side.
    const minH = Math.tan((44 * Math.PI) / 360);
    const v = Math.max(FOV, (Math.atan(minH / aspect) * 360) / Math.PI);
    camera.fov = Math.min(v, 84);
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    portrait = clamp((1 - aspect) / 0.5, 0, 1);
  }

  function frameFor(m: 'play' | 'title'): void {
    if (m === mode) return;
    mode = m;
    if (m === 'play') {
      // Come back to rest behind him.
      yawTarget = camYaw + angleDelta(camYaw, c.yaw);
      pitchTarget = PITCH;
      sinceLook = 0;
    } else {
      vx = vz = 0;
    }
  }

  setAspect(aspect);
  teleport(0, 0, 0);
  return c;
}
