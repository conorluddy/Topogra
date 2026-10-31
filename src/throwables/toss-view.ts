import * as THREE from 'three';

/**
 * The look follows a tossed sliotar: it lifts in step with the ball's climb, so the ball meets the
 * top edge exactly at its peak, then eases back down with it.
 */
export interface TossView {
  /** Elevation of the ball from the eye at release, in radians. */
  startAngle: number;
  peakAngle: number;
  /** How far the look must lift for the peak to touch the top edge; 0 when it already fits. */
  peakLift: number;
}

/** At its peak the tossed ball sits this far inside the top edge. */
const topMarginRadians = THREE.MathUtils.degToRad(4);

// === PUBLIC API ===

export function planTossView(
  eye: THREE.Vector3,
  ball: THREE.Vector3,
  peakHeight: number,
  lookPitch: number,
  halfFovRadians: number,
): TossView {
  const startAngle = getElevationAngle(eye, ball);
  const peakAngle = getElevationAngle(eye, ball.clone().setY(ball.y + peakHeight));

  return {
    startAngle,
    peakAngle,
    peakLift: Math.max(0, peakAngle - lookPitch - (halfFovRadians - topMarginRadians)),
  };
}

/** The lift for the ball's current elevation: none at release, all of it at the peak. */
export function getTossLookLift(tossView: TossView, ballAngle: number): number {
  const climb = (ballAngle - tossView.startAngle) / (tossView.peakAngle - tossView.startAngle);

  return THREE.MathUtils.clamp(climb, 0, 1) * tossView.peakLift;
}

export function getElevationAngle(eye: THREE.Vector3, point: THREE.Vector3): number {
  return Math.atan2(point.y - eye.y, Math.hypot(point.x - eye.x, point.z - eye.z));
}
