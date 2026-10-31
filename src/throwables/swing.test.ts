import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as THREE from 'three';
import {
  findBasContact,
  getPullbackRadians,
  getSwingRadians,
  strikePhaseSeconds,
  type ContactFrame,
} from './swing';

const forward = new THREE.Vector3(0, 0, -1);

/** A face sweeping forward along -Z through a ball hanging at the origin. */
function frame(faceZ: number, ballOffsetX = 0): ContactFrame {
  return {
    ball: new THREE.Vector3(ballOffsetX, 0, 0),
    face: { center: new THREE.Vector3(0, 0, faceZ), normal: forward.clone() },
  };
}

void test('a bas sweeping through the ball connects and drives it forward', () => {
  const contact = findBasContact(frame(0.1), frame(-0.1), 0.25);

  assert.ok(contact);
  assert.ok(contact.offset < 1e-9);
  assert.ok(contact.direction.distanceTo(forward) < 1e-9);
});

void test('a bas that has not yet reached the ball does not connect', () => {
  assert.equal(findBasContact(frame(0.3), frame(0.1), 0.25), undefined);
});

void test('a ball beside the bas is a whiff even when the face sweeps past', () => {
  assert.equal(findBasContact(frame(0.1, 0.4), frame(-0.1, 0.4), 0.25), undefined);
});

void test('an off-centre hit reports how far from the sweet spot it landed', () => {
  const contact = findBasContact(frame(0.1, 0.15), frame(-0.1, 0.15), 0.25);

  assert.ok(contact && Math.abs(contact.offset - 0.15) < 1e-9);
});

void test('a swing sweeps from the pull-back through rest to a follow-through, then recovers', () => {
  const swing = { elapsedSeconds: 0, pullbackRadians: getPullbackRadians(0.5), charge: 0.5 };
  const atRelease = getSwingRadians(swing) ?? Number.NaN;
  const atEnd = getSwingRadians({ ...swing, elapsedSeconds: strikePhaseSeconds }) ?? Number.NaN;

  assert.ok(atRelease > 0 && atEnd < 0);
  assert.equal(getSwingRadians({ ...swing, elapsedSeconds: 10 }), undefined);
  assert.ok(getPullbackRadians(0) > 0);
});
