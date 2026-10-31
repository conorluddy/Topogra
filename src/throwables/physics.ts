import * as THREE from 'three';
import type { WalkScale } from '../terrain-walk';

/** What the walker is holding: a hurl and sliotar, or a boomerang. */
export type Throwable = 'sliotar' | 'boomerang';

export type GroundHeight = (x: number, z: number) => number | undefined;

/** One projectile's motion. Vectors are mutated in place each step. */
export type Projectile =
  | { kind: 'flying'; item: Throwable; position: THREE.Vector3; velocity: THREE.Vector3 }
  | { kind: 'rolling'; item: Throwable; position: THREE.Vector3; velocity: THREE.Vector3 }
  | {
      kind: 'returning';
      item: 'boomerang';
      position: THREE.Vector3;
      origin: THREE.Vector3;
      forward: THREE.Vector3;
      left: THREE.Vector3;
      reach: number;
      elapsedSeconds: number;
    }
  | { kind: 'resting'; item: Throwable; position: THREE.Vector3 };

// Sizes are in eye heights, so the toys feel the same on any map.
// Matches the drawn sliotar: 70 mm against the viewmodel's 1.25-eye-height hurl (864 mm).
const sliotarRadiusEyeHeights = 0.0506;
const sliotarSpeedEyeHeights = { min: 8, max: 30 };
const strikeLoftRadians = 0.25;
const restitution = 0.5;
const tangentialFriction = 0.8;
/** Below this bounce speed (eye heights per second) the ball settles into a roll. */
const rollSpeedEyeHeights = 0.6;
const rollDragPerSecond = 0.6;
const restSpeedEyeHeights = 0.05;
const restSlope = 0.02;
const slopeSampleEyeHeights = 0.1;

export const boomerangDurationSeconds = 2.5;
const boomerangReachEyeHeights = { min: 6, max: 20 };
const boomerangLiftEyeHeights = 1.5;
/** A tap barely lifts the ball (too low to swing at); a full hold sends it high. */
const tossPeakEyeHeights = { min: 0.3, max: 5 };

// Reused every step so the physics doesn't churn the garbage collector.
const scratchNormal = new THREE.Vector3();

// === PUBLIC API ===

/** A struck sliotar: away along `direction` with a little loft, faster for a harder strike. */
export function launchSliotar(
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  charge: number,
  scale: WalkScale,
): Projectile {
  const speed =
    THREE.MathUtils.lerp(sliotarSpeedEyeHeights.min, sliotarSpeedEyeHeights.max, charge) *
    scale.eyeHeight;
  const aim = direction.clone().normalize();
  const pitch = Math.asin(THREE.MathUtils.clamp(aim.y, -1, 1)) + strikeLoftRadians;
  const heading = aim.setY(0).normalize();
  const velocity = heading
    .multiplyScalar(Math.cos(pitch))
    .setY(Math.sin(pitch))
    .multiplyScalar(speed);

  return { kind: 'flying', item: 'sliotar', position: origin.clone(), velocity };
}

/** How far above the hand a toss peaks; a longer hold throws it higher. */
export function getTossPeakHeight(charge: number, scale: WalkScale): number {
  return (
    THREE.MathUtils.lerp(tossPeakEyeHeights.min, tossPeakEyeHeights.max, charge) * scale.eyeHeight
  );
}

/**
 * The first stage of a strike: the sliotar goes up out of the off hand. With `dropThrough`, it
 * drifts sideways so it comes down through that point, as when hopped off a bas held out of the strike zone.
 */
export function launchToss(
  origin: THREE.Vector3,
  peakHeight: number,
  scale: WalkScale,
  dropThrough?: THREE.Vector3,
): Projectile {
  const gravity = scale.gravityPerSecondSquared;
  const speed = Math.sqrt(2 * gravity * peakHeight);
  const velocity = new THREE.Vector3(0, speed, 0);

  if (dropThrough) {
    const rise = dropThrough.y - origin.y;
    // Descending root of y(t) = speed·t − g·t²/2 = rise; past the peak if the point sits below it.
    const secondsToDrop =
      (speed + Math.sqrt(Math.max(speed * speed - 2 * gravity * rise, 0))) / gravity;

    velocity.x = (dropThrough.x - origin.x) / secondsToDrop;
    velocity.z = (dropThrough.z - origin.z) / secondsToDrop;
  }

  return { kind: 'flying', item: 'sliotar', position: origin.clone(), velocity };
}

export function launchBoomerang(
  origin: THREE.Vector3,
  viewDirection: THREE.Vector3,
  charge: number,
  scale: WalkScale,
): Projectile {
  const forward = viewDirection.clone().setY(0).normalize();

  return {
    kind: 'returning',
    item: 'boomerang',
    position: origin.clone(),
    origin: origin.clone(),
    forward,
    left: new THREE.Vector3(forward.z, 0, -forward.x),
    reach:
      THREE.MathUtils.lerp(boomerangReachEyeHeights.min, boomerangReachEyeHeights.max, charge) *
      scale.eyeHeight,
    elapsedSeconds: 0,
  };
}

/**
 * Advances a projectile; undefined when it's back in hand (caught near `catcher`, or lost off the
 * model's edge).
 */
export function stepProjectile(
  projectile: Projectile,
  elapsedSeconds: number,
  getGroundHeight: GroundHeight,
  scale: WalkScale,
  catcher: THREE.Vector3,
): Projectile | undefined {
  switch (projectile.kind) {
    case 'flying':
      return stepFlying(projectile, elapsedSeconds, getGroundHeight, scale);
    case 'rolling':
      return stepRolling(projectile, elapsedSeconds, getGroundHeight, scale);
    case 'returning':
      return stepReturning(projectile, elapsedSeconds, getGroundHeight, scale, catcher);
    case 'resting':
      return getGroundHeight(projectile.position.x, projectile.position.z) === undefined
        ? undefined
        : projectile;
  }
}

// === HELPERS ===

function stepFlying(
  projectile: Extract<Projectile, { kind: 'flying' }>,
  elapsedSeconds: number,
  getGroundHeight: GroundHeight,
  scale: WalkScale,
): Projectile | undefined {
  const { position, velocity } = projectile;

  velocity.y -= scale.gravityPerSecondSquared * elapsedSeconds;
  position.addScaledVector(velocity, elapsedSeconds);

  const ground = getGroundHeight(position.x, position.z);
  const radius = sliotarRadiusEyeHeights * scale.eyeHeight;

  if (ground === undefined) {
    return undefined;
  }

  if (position.y - radius > ground) {
    return projectile;
  }

  const normal = sampleGroundNormal(position, getGroundHeight, scale, scratchNormal);
  const normalSpeed = velocity.dot(normal);

  position.y = ground + radius;

  if (normalSpeed < 0) {
    velocity.addScaledVector(normal, -normalSpeed);
    velocity.multiplyScalar(tangentialFriction);
    velocity.addScaledVector(normal, -normalSpeed * restitution);
  }

  return Math.abs(normalSpeed) * restitution < rollSpeedEyeHeights * scale.eyeHeight
    ? { kind: 'rolling', item: projectile.item, position, velocity: velocity.setY(0) }
    : projectile;
}

function stepRolling(
  projectile: Extract<Projectile, { kind: 'rolling' }>,
  elapsedSeconds: number,
  getGroundHeight: GroundHeight,
  scale: WalkScale,
): Projectile | undefined {
  const { position, velocity } = projectile;
  const normal = sampleGroundNormal(position, getGroundHeight, scale, scratchNormal);

  if (normal.lengthSq() === 0) {
    return undefined;
  }

  // Gravity's pull along the surface, projected onto the ground plane.
  velocity.x += scale.gravityPerSecondSquared * normal.x * normal.y * elapsedSeconds;
  velocity.z += scale.gravityPerSecondSquared * normal.z * normal.y * elapsedSeconds;
  velocity.multiplyScalar(Math.exp(-rollDragPerSecond * elapsedSeconds));
  position.x += velocity.x * elapsedSeconds;
  position.z += velocity.z * elapsedSeconds;

  const ground = getGroundHeight(position.x, position.z);

  if (ground === undefined) {
    return undefined;
  }

  position.y = ground + sliotarRadiusEyeHeights * scale.eyeHeight;
  const slope = Math.hypot(normal.x, normal.z) / normal.y;
  const isSettled = velocity.length() < restSpeedEyeHeights * scale.eyeHeight && slope < restSlope;

  return isSettled ? { kind: 'resting', item: projectile.item, position } : projectile;
}

function stepReturning(
  projectile: Extract<Projectile, { kind: 'returning' }>,
  elapsedSeconds: number,
  getGroundHeight: GroundHeight,
  scale: WalkScale,
  catcher: THREE.Vector3,
): Projectile | undefined {
  projectile.elapsedSeconds = Math.min(
    projectile.elapsedSeconds + elapsedSeconds,
    boomerangDurationSeconds,
  );

  const previous = projectile.position.clone();
  const angle = (2 * Math.PI * projectile.elapsedSeconds) / boomerangDurationSeconds;
  const { position, origin, forward, left, reach } = projectile;

  // An ellipse through the origin: out along the throw, banking left, home again.
  position
    .copy(origin)
    .addScaledVector(forward, (reach * (1 - Math.cos(angle))) / 2)
    .addScaledVector(left, (reach / 3) * Math.sin(angle));
  position.y += boomerangLiftEyeHeights * scale.eyeHeight * Math.sin(angle / 2);

  const ground = getGroundHeight(position.x, position.z);

  if (ground === undefined) {
    return undefined;
  }

  if (position.y <= ground) {
    position.y = ground;

    return { kind: 'resting', item: 'boomerang', position };
  }

  if (projectile.elapsedSeconds < boomerangDurationSeconds) {
    return projectile;
  }

  if (position.distanceTo(catcher) <= scale.eyeHeight) {
    return undefined;
  }

  // The walker moved away: it drops where it arrives, carrying its last heading.
  const velocity = position.clone().sub(previous).divideScalar(Math.max(elapsedSeconds, 1e-3));

  return { kind: 'flying', item: 'boomerang', position, velocity };
}

/** Upward unit normal from central differences; zero length where the ground can't be sampled. */
function sampleGroundNormal(
  position: THREE.Vector3,
  getGroundHeight: GroundHeight,
  scale: WalkScale,
  target: THREE.Vector3,
) {
  const epsilon = slopeSampleEyeHeights * scale.eyeHeight;
  const east = getGroundHeight(position.x + epsilon, position.z);
  const west = getGroundHeight(position.x - epsilon, position.z);
  const south = getGroundHeight(position.x, position.z + epsilon);
  const north = getGroundHeight(position.x, position.z - epsilon);

  if (east === undefined || west === undefined || south === undefined || north === undefined) {
    return target.set(0, 0, 0);
  }

  return target
    .set(-(east - west) / (2 * epsilon), 1, -(south - north) / (2 * epsilon))
    .normalize();
}
