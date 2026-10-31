import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  boomerangDurationSeconds,
  getTossPeakHeight,
  launchBoomerang,
  launchSliotar,
  launchToss,
  stepProjectile,
  type Projectile,
} from './physics';
import { getWalkScale } from '../terrain-walk';

const scale = getWalkScale(100);
const stepSeconds = 1 / 60;

type Ground = (x: number, z: number) => number | undefined;

const flat: Ground = (x, z) => (Math.hypot(x, z) < 10 ? 0 : undefined);
const farAway = new THREE.Vector3(1000, 0, 1000);

function simulate(
  projectile: Projectile,
  seconds: number,
  ground: Ground = flat,
  catcher = farAway,
) {
  const kinds: string[] = [];
  const heights: number[] = [];
  let current: Projectile | undefined = projectile;

  for (let elapsed = 0; elapsed < seconds && current; elapsed += stepSeconds) {
    current = stepProjectile(current, stepSeconds, ground, scale, catcher);
    kinds.push(current?.kind ?? 'gone');
    heights.push(current?.position.y ?? 0);
  }

  return { final: current, kinds, heights };
}

void test('on flat ground a struck sliotar bounces lower each time and comes to rest', () => {
  const origin = new THREE.Vector3(0, scale.eyeHeight, 0);
  const projectile = launchSliotar(origin, new THREE.Vector3(0, 1, 0.3), 0.3, scale);
  const { final, heights } = simulate(projectile, 30);
  const peaks = heights.filter(
    (height, index) =>
      index > 0 && height > (heights[index - 1] ?? 0) && height >= (heights[index + 1] ?? 0),
  );

  assert.equal(final?.kind, 'resting');
  assert.ok(peaks.length >= 2, `expected several bounces, got ${peaks.length}`);
  peaks.slice(1).forEach((peak, index) => {
    assert.ok(peak < (peaks[index] ?? Infinity));
  });
});

void test('on a slope a resting sliotar rolls downhill', () => {
  const slope = (x: number) => (Math.abs(x) < 10 ? -0.3 * x : undefined);
  const start = new THREE.Vector3(0, 0, 0);
  const projectile: Projectile = {
    kind: 'rolling',
    item: 'sliotar',
    position: start.clone(),
    velocity: new THREE.Vector3(),
  };
  const { final } = simulate(projectile, 1, slope);

  assert.ok(final && final.position.x > start.x + scale.eyeHeight * 0.1);
});

void test('a boomerang returns to its origin after its flight', () => {
  const origin = new THREE.Vector3(0, scale.eyeHeight, 0);
  const projectile = launchBoomerang(origin, new THREE.Vector3(1, 0, 0), 1, scale);
  const { final: current } = simulate(projectile, boomerangDurationSeconds - stepSeconds / 2);

  assert.equal(current?.kind, 'returning');
  assert.ok(current.position.distanceTo(origin) < scale.eyeHeight * 0.05);
});

void test('a boomerang returning near the walker is caught', () => {
  const origin = new THREE.Vector3(0, scale.eyeHeight, 0);
  const projectile = launchBoomerang(origin, new THREE.Vector3(1, 0, 0), 0.5, scale);
  const { final } = simulate(projectile, boomerangDurationSeconds + 0.5, flat, origin);

  assert.equal(final, undefined);
});

void test('a sliotar struck off the model edge is lost and resets', () => {
  const origin = new THREE.Vector3(9, scale.eyeHeight, 0);
  const projectile = launchSliotar(origin, new THREE.Vector3(1, 0.2, 0), 1, scale);
  const { final, kinds } = simulate(projectile, 10);

  assert.equal(final, undefined);
  assert.equal(kinds.at(-1), 'gone');
});

void test('a tossed sliotar rises a couple of eye heights and falls back past the hand', () => {
  const origin = new THREE.Vector3(0, 2 * scale.eyeHeight, 0);
  const { heights } = simulate(launchToss(origin, getTossPeakHeight(0.5, scale), scale), 2);
  const peak = Math.max(...heights) - origin.y;

  assert.ok(
    peak > 2 * scale.eyeHeight && peak < 3 * scale.eyeHeight,
    `peak ${peak / scale.eyeHeight}`,
  );
  assert.ok(heights.some((height) => height < origin.y));
});

void test('a longer hold tosses the sliotar higher, up to twice the half-charge toss', () => {
  const tap = getTossPeakHeight(0, scale);
  const half = getTossPeakHeight(0.5, scale);
  const full = getTossPeakHeight(1, scale);

  assert.ok(tap < scale.eyeHeight);
  assert.ok(tap < half && half < full);
  assert.ok(Math.abs(full - 5 * scale.eyeHeight) < 1e-9);
});

void test('a sliotar hopped off the bas drifts over and drops through the strike zone', () => {
  const origin = new THREE.Vector3(0, 2 * scale.eyeHeight, 0);
  const strikeZone = new THREE.Vector3(-0.6, -0.1, 0.4).multiplyScalar(scale.eyeHeight).add(origin);
  let current: Projectile | undefined = launchToss(
    origin,
    getTossPeakHeight(0.5, scale),
    scale,
    strikeZone,
  );
  let sidewaysMiss = Infinity;

  // Sideways offset as it falls past the strike height, where the swing meets it.
  for (let elapsed = 0; elapsed < 3 && current; elapsed += stepSeconds) {
    current = stepProjectile(current, stepSeconds, flat, scale, farAway);

    if (
      current?.kind === 'flying' &&
      current.velocity.y < 0 &&
      current.position.y <= strikeZone.y
    ) {
      sidewaysMiss = Math.hypot(
        current.position.x - strikeZone.x,
        current.position.z - strikeZone.z,
      );
      break;
    }
  }

  assert.ok(sidewaysMiss < 0.02 * scale.eyeHeight, `missed by ${sidewaysMiss / scale.eyeHeight}`);
});
