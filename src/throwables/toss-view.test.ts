import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import { getWalkScale } from '../terrain-walk';
import { getTossPeakHeight } from './physics';
import { getTossLookLift, planTossView } from './toss-view';

const scale = getWalkScale(100);

void test('the look lifts with a toss so the ball meets the top edge at its peak', () => {
  const eye = new THREE.Vector3(0, scale.eyeHeight, 0);
  const ball = new THREE.Vector3(0, 0.2 * scale.eyeHeight, -0.8 * scale.eyeHeight);
  const halfFov = THREE.MathUtils.degToRad(35);
  const view = planTossView(eye, ball, getTossPeakHeight(0.5, scale), 0, halfFov);

  assert.ok(view.peakLift > 0);
  assert.equal(getTossLookLift(view, view.startAngle), 0);
  assert.ok(Math.abs(getTossLookLift(view, view.peakAngle) - view.peakLift) < 1e-9);
  assert.ok(view.peakAngle - view.peakLift < halfFov);
});
