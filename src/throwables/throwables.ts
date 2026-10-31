import * as THREE from 'three';
import type { WalkScale } from '../terrain-walk';
import { playHurlSlap } from './hurl-slap';
import { createThrowableModels, type ThrowableModels } from './models';
import {
  getTossPeakHeight,
  launchBoomerang,
  launchSliotar,
  launchToss,
  stepProjectile,
  type GroundHeight,
  type Projectile,
  type Throwable,
} from './physics';
import {
  aimStrike,
  basContactRadiusEyeHeights,
  findBasContact,
  getPullbackRadians,
  getSwingRadians,
  isInStrikePhase,
  type ContactFrame,
  type HurlSwing,
} from './swing';
import { getElevationAngle, getTossLookLift, planTossView, type TossView } from './toss-view';

/**
 * Spike: walk-only toys. Click to toss the sliotar, click again to swing the hurl through it; or
 * throw a boomerang that loops back. Driven by `terrain-walk.ts`; nothing here reaches exports.
 */
export interface TerrainThrowables {
  readonly heldItem: Throwable;
  /** Sizes everything for this walk's map. */
  start(scale: WalkScale): void;
  charge(): void;
  release(): void;
  /** Swaps hurl and boomerang, recalling anything thrown. */
  toggle(): void;
  recall(): void;
  step(elapsedSeconds: number): void;
  stop(): void;
  dispose(): void;
}

interface TerrainThrowablesOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  getGroundHeight: GroundHeight;
}

const fullChargeSeconds = 1;
/** Below this a release is a tap: it balances the sliotar on the bas instead of tossing. */
const tapCharge = 0.15;
/** Once a tossed ball falls this far below the bas the chance has gone. */
const whiffBelowBasEyeHeights = 0.6;
const lookSettlePerSecond = 4;
const boomerangFlickSeconds = 0.3;

// Reused every frame so throwing doesn't churn the garbage collector.
const scratchDirection = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();

// === PUBLIC API ===

export function createTerrainThrowables(options: TerrainThrowablesOptions): TerrainThrowables {
  const { scene, camera, getGroundHeight } = options;
  let models: ThrowableModels | undefined;
  let scale: WalkScale | undefined;
  let heldItem: Throwable = 'sliotar';
  let projectile: Projectile | undefined;
  let chargeStartedAtMs: number | undefined;
  /** Set while a tossed sliotar is in the air, waiting for the swing. */
  let toss: TossView | undefined;
  let hurlSwing: HurlSwing | undefined;
  let boomerangFlickSecondsLeft = 0;
  /** Pitch the toss has added on top of the walker's own look. */
  let lookLift = 0;
  let isBalanced = false;

  const recall = () => {
    projectile = undefined;
    toss = undefined;
    isBalanced = false;
    models?.setProjectile(undefined, heldItem);
  };

  // --- Release, by stage ---

  const throwBoomerang = (charge: number, held: ThrowableModels, walkScale: WalkScale) => {
    const origin = held.getHandPosition(new THREE.Vector3());

    projectile = launchBoomerang(
      origin,
      camera.getWorldDirection(scratchDirection),
      charge,
      walkScale,
    );
    boomerangFlickSecondsLeft = boomerangFlickSeconds;
  };

  const tossSliotar = (charge: number, held: ThrowableModels, walkScale: WalkScale) => {
    const peakHeight = getTossPeakHeight(charge, walkScale);

    // Off the bas, the ball has to drift back over to where the swing sweeps.
    const dropThrough = isBalanced ? held.getBasPosition(new THREE.Vector3()) : undefined;

    projectile = launchToss(
      held.getSliotarPosition(new THREE.Vector3()),
      peakHeight,
      walkScale,
      dropThrough,
    );
    toss = planTossView(
      camera.position,
      projectile.position,
      peakHeight,
      getLookPitch(camera),
      THREE.MathUtils.degToRad(camera.fov / 2),
    );
  };

  const release = () => {
    if (chargeStartedAtMs === undefined || !scale || !models) {
      return;
    }

    const charge = readCharge(chargeStartedAtMs);

    chargeStartedAtMs = undefined;

    if (heldItem === 'boomerang') {
      throwBoomerang(charge, models, scale);
    } else if (toss) {
      // The swing always plays; the ball flies only if the bas actually sweeps through it.
      hurlSwing = { elapsedSeconds: 0, pullbackRadians: getPullbackRadians(charge), charge };
    } else if (charge < tapCharge) {
      isBalanced = !isBalanced;

      return;
    } else {
      // From the off hand, or from the bas when balanced: the origin is the held ball either way.
      tossSliotar(charge, models, scale);
      isBalanced = false;
    }

    models.setProjectile(projectile, heldItem);
  };

  // --- Each frame, in order ---

  const advanceProjectile = (
    elapsedSeconds: number,
    held: ThrowableModels,
    walkScale: WalkScale,
  ) => {
    if (!projectile) {
      return;
    }

    projectile = stepProjectile(
      projectile,
      elapsedSeconds,
      getGroundHeight,
      walkScale,
      camera.position,
    );

    // Dropped past the bas: a whiff. It falls on, and the next click picks it up.
    const whiffHeight =
      held.getBasPosition(scratchPosition).y - whiffBelowBasEyeHeights * walkScale.eyeHeight;

    if (!projectile || projectile.position.y < whiffHeight) {
      toss = undefined;
    }

    held.setProjectile(projectile, heldItem);
  };

  /** Lifts the look with a tossed ball, then eases it back once the toss is over. */
  const followToss = (elapsedSeconds: number) => {
    const targetLift =
      toss && projectile
        ? getTossLookLift(toss, getElevationAngle(camera.position, projectile.position))
        : lookLift * Math.exp(-lookSettlePerSecond * elapsedSeconds);

    // Applied as a delta, so the walker's own mouse look carries on underneath.
    camera.rotateX(targetLift - lookLift);
    lookLift = targetLift;
  };

  const poseViewmodel = (elapsedSeconds: number, held: ThrowableModels) => {
    const charge = chargeStartedAtMs === undefined ? 0 : readCharge(chargeStartedAtMs);
    const isChargingSwing = toss !== undefined && chargeStartedAtMs !== undefined;
    const swingRadians = hurlSwing ? getSwingRadians(hurlSwing) : undefined;

    held.updateViewmodel(camera, {
      heldItem,
      charge,
      swing: 1 - boomerangFlickSecondsLeft / boomerangFlickSeconds,
      hurlSwingRadians: swingRadians ?? (isChargingSwing ? getPullbackRadians(charge) : 0),
      isBasFlat: isBalanced,
      elapsedSeconds,
    });
  };

  /** Tests the ball against the sweeping bas between last frame and this one. */
  const checkBasContact = (held: ThrowableModels, walkScale: WalkScale) => {
    if (!hurlSwing || !isInStrikePhase(hurlSwing) || !toss || !projectile) {
      return;
    }

    const contactRadius = basContactRadiusEyeHeights * walkScale.eyeHeight;
    const current: ContactFrame = {
      ball: projectile.position.clone(),
      face: held.getBasFace({ center: new THREE.Vector3(), normal: new THREE.Vector3() }),
    };
    const previous = hurlSwing.lastContactFrame;
    const contact = previous && findBasContact(previous, current, contactRadius);

    hurlSwing.lastContactFrame = current;

    if (!contact) {
      return;
    }

    const viewDirection = camera.getWorldDirection(scratchDirection);
    const { aim, quality } = aimStrike(contact, viewDirection, contactRadius);
    const strength = hurlSwing.charge * quality;

    projectile = launchSliotar(contact.point, aim, strength, walkScale);
    toss = undefined;
    playHurlSlap(strength);
    held.setProjectile(projectile, heldItem);
  };

  return {
    get heldItem() {
      return heldItem;
    },
    start(walkScale) {
      scale = walkScale;
      models ??= createThrowableModels();
      models.setScale(walkScale.eyeHeight);
      scene.add(models.viewmodel, models.projectileMesh);
      recall();
    },
    charge() {
      // With a ball in the air this charges the swing; otherwise it recalls the last one, like E.
      // Only with a ball out, so a tap on the held ball keeps its balanced state to toggle.
      if (!toss && projectile) {
        recall();
      }

      chargeStartedAtMs = performance.now();
    },
    release,
    toggle() {
      heldItem = heldItem === 'sliotar' ? 'boomerang' : 'sliotar';
      chargeStartedAtMs = undefined;
      recall();
    },
    recall,
    step(elapsedSeconds) {
      if (!models || !scale) {
        return;
      }

      advanceProjectile(elapsedSeconds, models, scale);
      followToss(elapsedSeconds);
      boomerangFlickSecondsLeft = Math.max(boomerangFlickSecondsLeft - elapsedSeconds, 0);

      if (hurlSwing) {
        hurlSwing.elapsedSeconds += elapsedSeconds;
      }

      poseViewmodel(elapsedSeconds, models);
      // After posing, so the bas is where it's drawn this frame.
      checkBasContact(models, scale);

      if (hurlSwing && getSwingRadians(hurlSwing) === undefined) {
        hurlSwing = undefined;
      }
    },
    stop() {
      projectile = undefined;
      toss = undefined;
      hurlSwing = undefined;
      chargeStartedAtMs = undefined;
      boomerangFlickSecondsLeft = 0;
      lookLift = 0;
      isBalanced = false;

      if (models) {
        scene.remove(models.viewmodel, models.projectileMesh);
      }
    },
    dispose() {
      this.stop();
      models?.dispose();
      models = undefined;
    },
  };
}

// === HELPERS ===

function readCharge(chargeStartedAtMs: number) {
  const heldSeconds = (performance.now() - chargeStartedAtMs) / 1000;

  return THREE.MathUtils.clamp(heldSeconds / fullChargeSeconds, 0, 1);
}

function getLookPitch(camera: THREE.Camera) {
  return Math.asin(THREE.MathUtils.clamp(camera.getWorldDirection(scratchDirection).y, -1, 1));
}
