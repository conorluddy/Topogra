import * as THREE from 'three';

/**
 * Spike: a real hurl swing. The bas is a flat face that sweeps through an arc, and the sliotar
 * only flies if its path crosses that face. Angles are the hand's yaw: positive is pulled back,
 * 0 is the resting pose (where the toss drops), negative is the follow-through.
 */
export interface HurlSwing {
  elapsedSeconds: number;
  pullbackRadians: number;
  /** The hold that powered this swing, 0–1. */
  charge: number;
  /** Ball and bas last frame, for the swept contact test; unset on the swing's first frame. */
  lastContactFrame?: ContactFrame;
}

/** The bas at one instant, in world space. */
export interface BasFace {
  center: THREE.Vector3;
  /** Unit normal of the face, in the direction the swing drives it. */
  normal: THREE.Vector3;
}

export interface ContactFrame {
  ball: THREE.Vector3;
  face: BasFace;
}

/** How a contact sends the ball: which way, and how cleanly it was struck (0.5 rim to 1 centre). */
export interface Strike {
  aim: THREE.Vector3;
  quality: number;
}

export interface BasContact {
  point: THREE.Vector3;
  /** Distance from the sweet spot across the face; 0 is dead centre. */
  offset: number;
  /** Which way the face pushed the ball. */
  direction: THREE.Vector3;
}

/** Half the bas's width plus the sliotar's radius, in eye heights. */
export const basContactRadiusEyeHeights = 0.26;
export const strikePhaseSeconds = 0.22;
const recoverySeconds = 0.25;
const followThroughRadians = 1;
const pullback = { min: 0.15, max: 1.2 };
/** How much the bas's face, against the view, aims a strike; timing skews the face. */
const faceAimWeight = 0.6;

// === PUBLIC API ===

/** How far the hurl draws back while the swing charges; even a tap draws back enough to sweep. */
export function getPullbackRadians(charge: number): number {
  return THREE.MathUtils.lerp(
    pullback.min,
    pullback.max,
    Math.sqrt(THREE.MathUtils.clamp(charge, 0, 1)),
  );
}

/** The swing's yaw over time; undefined once it has recovered to rest. */
export function getSwingRadians(swing: HurlSwing): number | undefined {
  const { elapsedSeconds, pullbackRadians } = swing;

  if (elapsedSeconds <= strikePhaseSeconds) {
    const progress = elapsedSeconds / strikePhaseSeconds;

    return pullbackRadians - (pullbackRadians + followThroughRadians) * progress;
  }

  const recovery = (elapsedSeconds - strikePhaseSeconds) / recoverySeconds;

  if (recovery >= 1) {
    return undefined;
  }

  return -followThroughRadians * (1 - THREE.MathUtils.smoothstep(recovery, 0, 1));
}

export function isInStrikePhase(swing: HurlSwing): boolean {
  return swing.elapsedSeconds <= strikePhaseSeconds;
}

/**
 * Swept test between two frames: the ball and the face both move, so contact is where the ball's
 * signed distance from the face changes sign, and it counts only within the bas's radius.
 */
export function findBasContact(
  previous: ContactFrame,
  current: ContactFrame,
  contactRadius: number,
): BasContact | undefined {
  const previousDistance = signedDistance(previous);
  const currentDistance = signedDistance(current);

  if (previousDistance === 0 || Math.sign(previousDistance) === Math.sign(currentDistance)) {
    return undefined;
  }

  const crossing = previousDistance / (previousDistance - currentDistance);
  const point = previous.ball.clone().lerp(current.ball, crossing);
  const center = previous.face.center.clone().lerp(current.face.center, crossing);
  const normal = previous.face.normal.clone().lerp(current.face.normal, crossing).normalize();
  const across = point.clone().sub(center);
  const offset = across.addScaledVector(normal, -across.dot(normal)).length();

  if (offset > contactRadius) {
    return undefined;
  }

  // The face swept through the ball from its far side, so it drives the ball back that way.
  return { point, offset, direction: normal.multiplyScalar(Math.sign(previousDistance)) };
}

/** Blends the face's push with the view, and docks power for hitting off the sweet spot. */
export function aimStrike(
  contact: BasContact,
  viewDirection: THREE.Vector3,
  contactRadius: number,
): Strike {
  const aim = contact.direction
    .clone()
    .multiplyScalar(faceAimWeight)
    .addScaledVector(viewDirection, 1 - faceAimWeight)
    .normalize();

  return { aim, quality: 1 - 0.5 * (contact.offset / contactRadius) ** 2 };
}

// === HELPERS ===

function signedDistance({ ball, face }: ContactFrame) {
  return scratch.copy(ball).sub(face.center).dot(face.normal);
}

const scratch = new THREE.Vector3();
