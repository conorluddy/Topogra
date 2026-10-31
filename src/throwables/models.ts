import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Projectile, Throwable } from './physics';
import type { BasFace } from './swing';

/** Procedural low-poly hurl, sliotar and boomerang: a held viewmodel plus the thrown mesh. */
export interface ThrowableModels {
  /** Follows the camera each frame; the camera itself isn't in the scene. */
  viewmodel: THREE.Group;
  projectileMesh: THREE.Group;
  setScale(eyeHeight: number): void;
  getHandPosition(target: THREE.Vector3): THREE.Vector3;
  /** Where the held sliotar sits in the off hand, ready to toss. */
  getSliotarPosition(target: THREE.Vector3): THREE.Vector3;
  /** The bas's sweet spot at rest, ignoring the charge pull-back, so the strike zone stays put. */
  getBasPosition(target: THREE.Vector3): THREE.Vector3;
  /** The bas as posed this frame: where it is and which way the swing drives it. */
  getBasFace(target: BasFace): BasFace;
  setProjectile(projectile: Projectile | undefined, heldItem: Throwable): void;
  updateViewmodel(camera: THREE.Camera, pose: ViewmodelPose): void;
  dispose(): void;
}

export interface ViewmodelPose {
  heldItem: Throwable;
  /** 0–1 pull-back while the button is held. */
  charge: number;
  /** 0–1 progress through the boomerang's release flick; 1 at rest. */
  swing: number;
  /** The hurl's yaw: positive pulled back, 0 at rest, negative following through. */
  hurlSwingRadians: number;
  /** Rolls the hurl so the bas faces up, with the sliotar resting on it. */
  isBasFlat: boolean;
  elapsedSeconds: number;
}

// Hand offset from the eye, in eye heights: lower right, just past the near plane.
const handOffset = new THREE.Vector3(0.55, -0.8, -0.85);
const spinRadiansPerSecond = 18;
const restHandRollRadians = -0.3;
/** How quickly the held item catches up with the look; lower trails further. */
const lookFollowPerSecond = 14;
// Below the bottom edge, under the bas: the toss rises into view and drops past the sweet spot.
const sliotarInOffHand = new THREE.Vector3(-1.05, -0.15, 0);
const sliotarTossEyeHeights = 0.25;
/** Long enough that the grip end sits off-screen, in eye heights. */
const hurlLengthEyeHeights = 1.25;
// Real proportions (GAA rules): a 70 mm sliotar against a 34" (864 mm) adult hurl. The held
// viewmodel is drawn larger than life, like most first-person games, but keeps that ratio.
const sliotarDiameterMm = 70;
const hurlLengthMm = 864;
/** Adult limit is 16–17 cm at the widest point. */
const basWidthMm = 160;
const sliotarRadius = ((sliotarDiameterMm / hurlLengthMm) * hurlLengthEyeHeights) / 2;
const boomerangSpanEyeHeights = 0.6;
const hurlRollPerSecond = 12;
// Carrying the ball: gripped near the bas and held close to the chest, face up, the shaft
// running back down to the hand off-screen right. The bas sits just below the middle of the view.
const carryShaftInHand = new THREE.Vector3(-0.35, 0.25, -1).normalize();
const carryBasFromEye = new THREE.Vector3(-0.02, -0.14, -0.55);
const carryHandX = 0.3;
const carryHurlQuaternion = createCarryQuaternion(carryShaftInHand);

// === PUBLIC API ===

export function createThrowableModels(): ThrowableModels {
  const ash = new THREE.MeshStandardMaterial({ color: 0xd8b98a, roughness: 0.7 });
  const leather = new THREE.MeshStandardMaterial({ color: 0xf4f1e8, roughness: 0.6 });
  const seam = new THREE.MeshStandardMaterial({ color: 0x9a3b2e, roughness: 0.8 });
  const boomerangWood = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.6 });
  const viewmodel = new THREE.Group();
  const hand = new THREE.Group();
  // hurl: resting orientation; hurlRoll: roll about the shaft; hurlContent: the mesh and sweet spot.
  const hurl = new THREE.Group();
  const hurlRoll = new THREE.Group();
  const hurlContent = createHurl(ash);
  const basSweetSpot = new THREE.Object3D();
  const restBasPosition = new THREE.Vector3();
  // Replaced with the modelled bas's measured thickness once it loads.
  const basShape = { halfThickness: 0.0075 };
  // The hurl's swing-ready orientation in the hand; the modelled hurl sets its own on load.
  const restHurlRotation = new THREE.Euler();

  basSweetSpot.position.set(0, -0.08, 0);
  hurlContent.add(basSweetSpot);
  hurlRoll.add(hurlContent);
  hurl.add(hurlRoll);
  void replaceWithModelledHurl(restHurlRotation, hurlContent, ash, basSweetSpot, basShape);
  const heldSliotar = createSliotar(leather, seam);
  const heldBoomerang = createBoomerang(boomerangWood);
  const projectileMesh = new THREE.Group();
  const thrownSliotar = createSliotar(leather, seam);
  const thrownBoomerang = createBoomerang(boomerangWood);

  // Sized to the procedural stand-ins: the sliotar to its physics radius, the boomerang to its span.
  void replaceWithModel('sliotar.glb', 2 * sliotarRadius, [heldSliotar, thrownSliotar]);
  void replaceWithModel('boomerang.glb', boomerangSpanEyeHeights, [heldBoomerang, thrownBoomerang]);
  let eyeHeight = 1;
  let hasSettledPose = false;

  heldSliotar.position.copy(sliotarInOffHand);
  heldBoomerang.rotation.set(1.1, 0, 0.4);
  hand.add(hurl, heldSliotar, heldBoomerang);
  viewmodel.add(hand);
  projectileMesh.add(thrownSliotar, thrownBoomerang);
  projectileMesh.visible = false;

  return {
    viewmodel,
    projectileMesh,
    setScale(nextEyeHeight) {
      eyeHeight = nextEyeHeight;
      // A new walk snaps to the eye instead of swinging in from the last one.
      hasSettledPose = false;
      viewmodel.scale.setScalar(eyeHeight);
      projectileMesh.scale.setScalar(eyeHeight);
    },
    getHandPosition(target) {
      return hand.getWorldPosition(target);
    },
    getSliotarPosition(target) {
      return heldSliotar.getWorldPosition(target);
    },
    getBasPosition(target) {
      return target.copy(restBasPosition);
    },
    getBasFace(target) {
      basSweetSpot.getWorldPosition(target.center);
      // The bas faces the eye at rest; the swing drives it forward, along the hurl's -Z.
      target.normal
        .set(0, 0, -1)
        .applyQuaternion(hurlContent.getWorldQuaternion(scratchQuaternion));

      return target;
    },
    setProjectile(projectile, heldItem) {
      projectileMesh.visible = projectile !== undefined;
      thrownSliotar.visible = projectile?.item === 'sliotar';
      thrownBoomerang.visible = projectile?.item === 'boomerang';

      if (projectile) {
        projectileMesh.position.copy(projectile.position);
      }

      hurl.visible = heldItem === 'sliotar';
      heldSliotar.visible = heldItem === 'sliotar' && !projectile;
      heldBoomerang.visible = heldItem === 'boomerang' && !projectile;
    },
    updateViewmodel(
      camera,
      { heldItem, charge, swing, hurlSwingRadians, isBasFlat, elapsedSeconds },
    ) {
      camera.updateMatrixWorld();
      camera.matrixWorld.decompose(viewmodel.position, scratchQuaternion, scratchScale);
      // The hurl trails the look slightly, as if carried by an arm rather than bolted to the eye.
      viewmodel.quaternion.slerp(
        scratchQuaternion,
        hasSettledPose ? 1 - Math.exp(-lookFollowPerSecond * elapsedSeconds) : 1,
      );
      hasSettledPose = true;
      viewmodel.scale.setScalar(eyeHeight);
      hand.position.copy(handOffset);
      hand.rotation.set(0, 0, heldItem === 'sliotar' ? restHandRollRadians : 0);
      // A +90° roll turns the bas face (content +Z) to the hurl's local +X, mostly up across the view.
      hurlRoll.rotation.y +=
        ((isBasFlat ? Math.PI / 2 : 0) - hurlRoll.rotation.y) *
        (1 - Math.exp(-hurlRollPerSecond * elapsedSeconds));
      hurl.quaternion.setFromEuler(restHurlRotation);
      hurl.position.set(0, 0, 0);
      hand.updateMatrixWorld(true);
      // The sweet spot lies on the shaft axis, so the roll doesn't move it.
      basSweetSpot.getWorldPosition(restBasPosition);
      poseHand(hand, heldItem, charge, swing, hurlSwingRadians);
      // Blends with the roll, so the hurl comes level as the bas turns up.
      const carry = hurlRoll.rotation.y / (Math.PI / 2);

      if (heldItem === 'sliotar' && carry > 0.001) {
        hand.rotation.z *= 1 - carry;
        hand.position.x = THREE.MathUtils.lerp(handOffset.x, carryHandX, carry);
        hurl.quaternion.slerp(carryHurlQuaternion, carry);
        // Choke up: slide the hurl so the sweet spot (on the shaft axis) lands at the carry point.
        hurl.position
          .copy(carryBasFromEye)
          .sub(hand.position)
          .sub(
            scratchPosition
              .copy(basSweetSpot.position)
              .applyQuaternion(hurlContent.quaternion)
              .applyQuaternion(hurl.quaternion),
          )
          .multiplyScalar(carry);
      }

      hand.updateMatrixWorld(true);

      if (isBasFlat) {
        heldSliotar.position.copy(
          hand.worldToLocal(
            basSweetSpot
              .getWorldPosition(scratchPosition)
              .addScaledVector(
                getUpwardBasNormal(hurlContent, scratchNormal),
                (sliotarRadius + basShape.halfThickness) * eyeHeight,
              ),
          ),
        );
      } else {
        heldSliotar.position
          .copy(sliotarInOffHand)
          .setY(sliotarInOffHand.y + charge * sliotarTossEyeHeights);
      }

      if (projectileMesh.visible && thrownBoomerang.visible) {
        thrownBoomerang.rotation.y += spinRadiansPerSecond * elapsedSeconds;
      } else if (projectileMesh.visible) {
        thrownSliotar.rotation.x += spinRadiansPerSecond * elapsedSeconds;
      }
    },
    dispose() {
      for (const root of [viewmodel, projectileMesh]) {
        root.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            (object.geometry as THREE.BufferGeometry).dispose();

            // Loaded models bring their own materials; disposing a shared one twice is harmless.
            for (const material of [object.material].flat() as THREE.Material[]) {
              material.dispose();
            }
          }
        });
      }

      for (const material of [ash, leather, seam, boomerangWood]) {
        material.dispose();
      }
    },
  };
}

// === HELPERS ===

const scratchScale = new THREE.Vector3();
const scratchPosition = new THREE.Vector3();
const scratchNormal = new THREE.Vector3();

/** Shaft (local Y) along the given direction, with local X, the face once rolled 90°, pointing up. */
function createCarryQuaternion(shaft: THREE.Vector3) {
  const faceUp = new THREE.Vector3(0, 1, 0).addScaledVector(shaft, -shaft.y).normalize();
  const side = new THREE.Vector3().crossVectors(faceUp, shaft);

  return new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(faceUp, shaft, side),
  );
}

/** The bas face normal (content ±Z) on whichever side faces up, so the ball sits on top, not inside. */
function getUpwardBasNormal(hurlContent: THREE.Object3D, target: THREE.Vector3) {
  target.set(0, 0, 1).applyQuaternion(hurlContent.getWorldQuaternion(scratchQuaternion));

  return target.y < 0 ? target.negate() : target;
}

const scratchQuaternion = new THREE.Quaternion();

/** Charge pulls the item back; the swing sweeps through (hurl: sideways arc; boomerang: overhand). */
function poseHand(
  hand: THREE.Group,
  heldItem: Throwable,
  charge: number,
  swing: number,
  hurlSwingRadians: number,
) {
  const follow = Math.sin(Math.PI * Math.min(swing, 1));

  hand.rotation.set(0, 0, 0);

  if (heldItem === 'sliotar') {
    // A level sweep about the hand, so the bas passes back through its rest pose mid-swing.
    hand.rotation.set(0, hurlSwingRadians, restHandRollRadians);
  } else {
    hand.rotation.x = charge * 0.9 - follow * 1.6;
    hand.position.y += charge * 0.12 - follow * 0.1;
  }
}

/** Swaps in the modelled hurl once it loads; the procedural one stays if it can't. */
async function replaceWithModelledHurl(
  restHurlRotation: THREE.Euler,
  hurlContent: THREE.Group,
  material: THREE.Material,
  basSweetSpot: THREE.Object3D,
  basShape: { halfThickness: number },
) {
  // Read lazily: Vite's env doesn't exist when tests load this module in Node.
  const hurlModelUrl = `${import.meta.env.BASE_URL}models/hurl.glb`;

  try {
    const gltf = await new GLTFLoader().loadAsync(hurlModelUrl);
    const mesh = gltf.scene.getObjectByProperty('isMesh', true);

    if (!(mesh instanceof THREE.Mesh)) {
      throw new Error(`${hurlModelUrl} has no mesh`);
    }

    hurlContent.clear();
    hurlContent.rotation.set(0, 0, 0);
    const geometry = fitHurlGeometry(mesh as THREE.Mesh);

    hurlContent.add(new THREE.Mesh(geometry, material), basSweetSpot);
    // The modelled hurl stands grip-down, so the bas's middle sits near the top.
    basSweetSpot.position.set(0, hurlLengthEyeHeights * 0.88, 0);
    basShape.halfThickness = measureHalfThicknessNear(geometry, basSweetSpot.position.y);
    // Across the lower view, as when held: the grip off-screen right, rising to the bas at left.
    restHurlRotation.set(-0.15, 0, THREE.MathUtils.degToRad(90 - 17));
  } catch (error) {
    console.warn(JSON.stringify({ event: 'hurl_model_failed', message: String(error) }));
  }
}

/**
 * Swaps a loaded model into each group in place of its procedural children, centred and scaled
 * so its longest side is `longestSide`. The procedural mesh stays if the model can't load.
 */
async function replaceWithModel(fileName: string, longestSide: number, groups: THREE.Group[]) {
  const modelUrl = `${import.meta.env.BASE_URL}models/${fileName}`;

  try {
    const model = (await new GLTFLoader().loadAsync(modelUrl)).scene;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    model.position.sub(box.getCenter(new THREE.Vector3()));
    const fitted = new THREE.Group().add(model);

    fitted.scale.setScalar(longestSide / Math.max(size.x, size.y, size.z));

    for (const group of groups) {
      group.clear();
      group.add(fitted.clone());
    }
  } catch (error) {
    console.warn(
      JSON.stringify({ event: 'model_failed', model_url: modelUrl, message: String(error) }),
    );
  }
}

/** Bakes the node transform, stands the long axis upright, and sizes it like the procedural hurl. */
function fitHurlGeometry(mesh: THREE.Mesh) {
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);

  geometry.computeBoundingBox();
  const size = geometry.boundingBox?.getSize(new THREE.Vector3()) ?? new THREE.Vector3(1, 1, 1);

  // The model lies flat along X; turn it to run up Y like the procedural handle.
  if (size.x >= size.y && size.x >= size.z) {
    // Bas down, and its face (the model's thin axis) towards the eye.
    geometry.rotateZ(-Math.PI / 2).rotateY(Math.PI / 2);
  } else if (size.z >= size.y) {
    geometry.rotateX(-Math.PI / 2);
  }

  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new THREE.Box3();
  const length = box.max.y - box.min.y;

  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  const fit = hurlLengthEyeHeights / length;

  geometry.scale(fit, fit, fit);
  // Narrow (or widen) the bas to its real width; the length and thickness stay as modelled.
  geometry.scale(
    ((basWidthMm / hurlLengthMm) * hurlLengthEyeHeights) / measureBasWidth(geometry),
    1,
    1,
  );
  // Turned over about the shaft so the bas's toe points up when held across the view.
  geometry.rotateY(Math.PI);

  return geometry;
}

/** Deepest face-axis (Z) extent of the vertices around a height, for resting things on the face. */
function measureHalfThicknessNear(geometry: THREE.BufferGeometry, heightY: number) {
  const positions = geometry.getAttribute('position');
  const bandHalfHeight = hurlLengthEyeHeights * 0.05;
  let halfThickness = 0;

  for (let index = 0; index < positions.count; index += 1) {
    if (Math.abs(positions.getY(index) - heightY) < bandHalfHeight) {
      halfThickness = Math.max(halfThickness, Math.abs(positions.getZ(index)));
    }
  }

  return halfThickness;
}

/** Widest side-to-side (X) extent in the top fifth of an upright hurl, where the bas is. */
function measureBasWidth(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute('position');
  let minX = Infinity;
  let maxX = -Infinity;

  for (let index = 0; index < positions.count; index += 1) {
    if (positions.getY(index) > hurlLengthEyeHeights * 0.8) {
      minX = Math.min(minX, positions.getX(index));
      maxX = Math.max(maxX, positions.getX(index));
    }
  }

  return maxX - minX;
}

/** A flattened bas on an ash handle, in eye-height units, held up and slightly across. */
function createHurl(material: THREE.Material) {
  const group = new THREE.Group();
  const bas = new THREE.Shape();

  bas.moveTo(-0.05, 0);
  bas.quadraticCurveTo(-0.1, -0.1, -0.02, -0.17);
  bas.quadraticCurveTo(0.08, -0.15, 0.06, -0.05);
  bas.lineTo(0.02, 0);
  bas.closePath();

  const basMesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(bas, { depth: 0.015, bevelEnabled: false }),
    material,
  );
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.45, 8), material);

  handle.position.y = 0.22;
  basMesh.position.z = -0.0075;
  group.add(handle, basMesh);
  group.rotation.set(0.3, 0, 0.5);

  return group;
}

/** A white ball with a raised seam ring, sized to its physics radius. */
function createSliotar(leather: THREE.Material, seam: THREE.Material) {
  const group = new THREE.Group();
  const radius = sliotarRadius;
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), leather);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, radius * 0.12, 4, 16), seam);

  group.add(ball, ring);

  return group;
}

/** An extruded V, lying flat so it spins about its vertical axis. */
function createBoomerang(material: THREE.Material) {
  const shape = new THREE.Shape();

  shape.moveTo(-0.3, 0.12);
  shape.quadraticCurveTo(0, 0.02, 0.3, 0.12);
  shape.lineTo(0.3, 0.06);
  shape.quadraticCurveTo(0, -0.08, -0.3, 0.06);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });

  geometry.center();
  geometry.rotateX(-Math.PI / 2);

  // A group, so a loaded model can replace the mesh without moving the held pose.
  return new THREE.Group().add(new THREE.Mesh(geometry, material));
}
