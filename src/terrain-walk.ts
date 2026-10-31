import * as THREE from 'three';

/** Spike: a pointer-locked WASD stroll that keeps the camera standing on the terrain. */
export interface TerrainWalk {
  readonly isWalking: boolean;
  /**
   * Flies down to stand at world x/z (the centre when off the model), then hands over the controls.
   * `metersPerUnit` is the real ground distance one world unit covers, for a human eye height.
   */
  start(dropPoint: { x: number; z: number }, metersPerUnit: number): void;
  stop(): void;
}

interface TerrainWalkOptions {
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  /** World-space ground height under x/z; undefined off the model. */
  getGroundHeight: (x: number, z: number) => number | undefined;
  onFrame: () => void;
  onStop: () => void;
  /** An optional toy driven by mouse, Q and E while walking. */
  toy?: WalkToy;
}

/** A walk-only plaything; see `throwables/throwables.ts`. */
export interface WalkToy {
  start(scale: WalkScale): void;
  charge(): void;
  release(): void;
  toggle(): void;
  recall(): void;
  step(elapsedSeconds: number): void;
  stop(): void;
}

const eyeHeightMeters = 1.7;
/**
 * The mesh has a fixed vertex grid, so its facets grow with the map span; an eye nearer than a few
 * facets sees flat triangles. This floor (about 40 m on an 8 km map) wins on all but sub-kilometre
 * maps, where the real 1.7 m eye applies. Dialled in by comparing 1.7, 20 and 60 m on Errigal.
 */
const minimumEyeHeightUnits = 0.01;
// Speed and jump scale with the eye, so a stroll feels the same on any map: about a minute across.
const walkEyeHeightsPerSecond = 3;
const sprintMultiplier = 4;
// A floaty hop: peaks at three quarters of eye height and lands after 0.6 s.
const jumpPeakEyeHeights = 0.75;
const jumpAirtimeSeconds = 0.6;
const lookRadiansPerPixel = 0.002;
// A near plane a fraction of the eye height keeps the ground unclipped with a tight near/far ratio.
const nearPlaneEyeHeights = 0.2;
const walkFarPlane = 6;
// Wider than the studio lens, like a game's eye; about an 18 mm full-frame lens.
const walkFovDegrees = 70;
const landingDurationMs = 1200;

interface Landing {
  startedAtMs: number;
  from: { position: THREE.Vector3; quaternion: THREE.Quaternion; near: number; fov: number };
  to: { position: THREE.Vector3; quaternion: THREE.Quaternion; near: number };
}

/** World-unit sizes for one walk, derived from the map's real scale. */
export interface WalkScale {
  eyeHeight: number;
  walkSpeedPerSecond: number;
  jumpSpeedPerSecond: number;
  gravityPerSecondSquared: number;
  nearPlane: number;
}

// Reused every frame so walking doesn't churn the garbage collector.
const scratchForward = new THREE.Vector3();
const scratchRight = new THREE.Vector3();

// === PUBLIC API ===

export function getWalkScale(metersPerUnit: number): WalkScale {
  const eyeHeight = Math.max(eyeHeightMeters / metersPerUnit, minimumEyeHeightUnits);
  const gravityPerSecondSquared = (8 * jumpPeakEyeHeights * eyeHeight) / jumpAirtimeSeconds ** 2;

  return {
    eyeHeight,
    walkSpeedPerSecond: walkEyeHeightsPerSecond * eyeHeight,
    jumpSpeedPerSecond: (gravityPerSecondSquared * jumpAirtimeSeconds) / 2,
    gravityPerSecondSquared,
    nearPlane: nearPlaneEyeHeights * eyeHeight,
  };
}

export function createTerrainWalk(options: TerrainWalkOptions): TerrainWalk {
  const { camera, canvas, toy } = options;
  const heldKeys = new Set<string>();
  const euler = new THREE.Euler(0, 0, 0, 'YXZ');
  let frame = 0;
  let previousTimeMs = 0;
  let savedLens = { near: camera.near, far: camera.far, fov: camera.fov };
  let isWalking = false;
  let landing: Landing | undefined;
  let scale = getWalkScale(1);
  let isLookInverted = false;
  /** Height above the ground while airborne; undefined when standing. */
  let jump: { height: number; speedPerSecond: number } | undefined;
  const hint = document.createElement('div');

  hint.className = 'terrain-walk-hint';
  hint.setAttribute('aria-live', 'polite');

  const updateHint = () => {
    const toyHint = toy
      ? ' · Tap: ball on hurl · Hold: toss, again to strike · Q hurl/boomerang · E recall'
      : '';

    hint.textContent = `WASD move · Shift sprint · Space jump${toyHint} · I invert look (${isLookInverted ? 'on' : 'off'}) · Esc exit`;
  };

  const onMouseMove = (event: MouseEvent) => {
    if (landing) {
      return;
    }

    euler.setFromQuaternion(camera.quaternion);
    euler.y -= event.movementX * lookRadiansPerPixel;
    euler.x = THREE.MathUtils.clamp(
      euler.x - event.movementY * lookRadiansPerPixel * (isLookInverted ? -1 : 1),
      -Math.PI * 0.49,
      Math.PI * 0.49,
    );
    camera.quaternion.setFromEuler(euler);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // Browser and OS shortcuts (reload, address bar, tab switching, F-keys) keep working.
    if (event.metaKey || event.ctrlKey || event.altKey || /^(Tab|F\d+)$/.test(event.key)) {
      return;
    }

    if (event.key === 'Escape') {
      stop();
    } else if (event.code === 'Space' && !jump && !landing) {
      jump = { height: 0, speedPerSecond: scale.jumpSpeedPerSecond };
    } else if (event.code === 'KeyQ' && !event.repeat) {
      toy?.toggle();
    } else if (event.code === 'KeyE' && !event.repeat) {
      toy?.recall();
    } else if (event.code === 'KeyI' && !event.repeat) {
      isLookInverted = !isLookInverted;
      updateHint();
    } else {
      heldKeys.add(event.code);
    }

    // Walking keys must not reach the studio's shortcuts.
    event.preventDefault();
    event.stopPropagation();
  };

  const onKeyUp = (event: KeyboardEvent) => {
    heldKeys.delete(event.code);
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button === 0 && !landing && document.pointerLockElement === canvas) {
      toy?.charge();
    }
  };

  const onMouseUp = (event: MouseEvent) => {
    if (event.button === 0) {
      toy?.release();
    }
  };

  const onPointerLockChange = () => {
    if (document.pointerLockElement !== canvas) {
      stop();
    }
  };

  const tick = (nowMs: number) => {
    const elapsedSeconds = Math.min((nowMs - previousTimeMs) / 1000, 0.05);

    previousTimeMs = nowMs;

    if (landing) {
      flyLanding(camera, landing, nowMs);
      landing = nowMs - landing.startedAtMs >= landingDurationMs ? undefined : landing;
    } else {
      stepCamera(camera, heldKeys, elapsedSeconds, options.getGroundHeight, scale);
      jump = advanceJump(jump, elapsedSeconds, scale.gravityPerSecondSquared);
      // Standing still, the walker rides the ground as a new landscape morphs underneath.
      followGround(camera, options.getGroundHeight, jump?.height ?? 0, scale.eyeHeight);
      toy?.step(elapsedSeconds);
    }

    options.onFrame();
    frame = requestAnimationFrame(tick);
  };

  const start = (dropPoint: { x: number; z: number }, metersPerUnit: number) => {
    if (isWalking) {
      return;
    }

    isWalking = true;
    scale = getWalkScale(metersPerUnit);
    savedLens = { near: camera.near, far: camera.far, fov: camera.fov };
    camera.far = walkFarPlane;
    camera.updateProjectionMatrix();
    updateHint();
    canvas.parentElement?.append(hint);
    landing = planLanding(camera, dropPoint, options.getGroundHeight, scale);
    toy?.start(scale);
    // Refused without a user gesture (scripted input); keys still walk, only mouse look is lost.
    canvas.requestPointerLock().catch(() => undefined);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    previousTimeMs = performance.now();
    frame = requestAnimationFrame(tick);
  };

  const stop = () => {
    if (!isWalking) {
      return;
    }

    isWalking = false;
    landing = undefined;
    cancelAnimationFrame(frame);
    heldKeys.clear();
    jump = undefined;
    hint.remove();
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    toy?.stop();
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('pointerlockchange', onPointerLockChange);

    if (document.pointerLockElement === canvas) {
      document.exitPointerLock();
    }

    camera.near = savedLens.near;
    camera.far = savedLens.far;
    camera.fov = savedLens.fov;
    camera.updateProjectionMatrix();
    options.onStop();
  };

  return {
    get isWalking() {
      return isWalking;
    },
    start,
    stop,
  };
}

// === HELPERS ===

function stepCamera(
  camera: THREE.PerspectiveCamera,
  heldKeys: ReadonlySet<string>,
  elapsedSeconds: number,
  getGroundHeight: TerrainWalkOptions['getGroundHeight'],
  scale: WalkScale,
) {
  const isHeld = (...codes: string[]) => codes.some((code) => heldKeys.has(code));
  const forwardInput = Number(isHeld('KeyW', 'ArrowUp')) - Number(isHeld('KeyS', 'ArrowDown'));
  const strafeInput = Number(isHeld('KeyD', 'ArrowRight')) - Number(isHeld('KeyA', 'ArrowLeft'));

  if (forwardInput === 0 && strafeInput === 0) {
    return;
  }

  const forward = camera.getWorldDirection(scratchForward).setY(0).normalize();
  const right = scratchRight.crossVectors(forward, camera.up).normalize();
  const speed =
    scale.walkSpeedPerSecond * (isHeld('ShiftLeft', 'ShiftRight') ? sprintMultiplier : 1);
  const step = forward
    .multiplyScalar(forwardInput)
    .addScaledVector(right, strafeInput)
    .setLength(speed * elapsedSeconds);
  const x = camera.position.x + step.x;
  const z = camera.position.z + step.z;
  const ground = getGroundHeight(x, z);

  // The model's edge is a wall.
  if (ground === undefined) {
    return;
  }

  camera.position.x = x;
  camera.position.z = z;
}

/** Keeps eye level above the ground; holds height where the ground can't be found (mid-morph bounds lag). */
function followGround(
  camera: THREE.PerspectiveCamera,
  getGroundHeight: TerrainWalkOptions['getGroundHeight'],
  jumpHeight: number,
  eyeHeight: number,
) {
  const ground = getGroundHeight(camera.position.x, camera.position.z);

  if (ground !== undefined) {
    camera.position.y = ground + eyeHeight + jumpHeight;
  }
}

/** Steps a jump's arc under gravity; undefined once it lands. */
function advanceJump(
  jump: { height: number; speedPerSecond: number } | undefined,
  elapsedSeconds: number,
  gravityPerSecondSquared: number,
) {
  if (!jump) {
    return undefined;
  }

  const speedPerSecond = jump.speedPerSecond - gravityPerSecondSquared * elapsedSeconds;
  const height = jump.height + speedPerSecond * elapsedSeconds;

  return height > 0 ? { height, speedPerSecond } : undefined;
}

/** The current pose and an eye-level pose at the drop point, facing level along the current heading. */
function planLanding(
  camera: THREE.PerspectiveCamera,
  dropPoint: { x: number; z: number },
  getGroundHeight: TerrainWalkOptions['getGroundHeight'],
  { eyeHeight, nearPlane }: WalkScale,
): Landing {
  const ground = getGroundHeight(dropPoint.x, dropPoint.z);
  const standing = camera.clone();

  if (ground === undefined) {
    standing.position.set(0, (getGroundHeight(0, 0) ?? 0) + eyeHeight, 0);
  } else {
    standing.position.set(dropPoint.x, ground + eyeHeight, dropPoint.z);
  }

  const forward = camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();

  standing.lookAt(standing.position.clone().add(forward));
  // Reduced motion lands instantly.
  const startedAtMs = matchMedia('(prefers-reduced-motion: reduce)').matches
    ? -Infinity
    : performance.now();

  return {
    startedAtMs,
    from: {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      near: camera.near,
      fov: camera.fov,
    },
    to: { position: standing.position, quaternion: standing.quaternion, near: nearPlane },
  };
}

/** Swoops along the landing: the camera dives first and levels its gaze near the ground. */
function flyLanding(camera: THREE.PerspectiveCamera, landing: Landing, nowMs: number) {
  const progress = THREE.MathUtils.clamp((nowMs - landing.startedAtMs) / landingDurationMs, 0, 1);
  const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
  const levelling = progress ** 3;

  camera.position.lerpVectors(landing.from.position, landing.to.position, eased);
  camera.quaternion.slerpQuaternions(landing.from.quaternion, landing.to.quaternion, levelling);
  // Shrinks the near plane geometrically so depth precision tracks the camera's distance.
  camera.near = landing.from.near * (landing.to.near / landing.from.near) ** eased;
  // Widening from the studio lens to the eye reads as zooming out into first person.
  camera.fov = THREE.MathUtils.lerp(landing.from.fov, walkFovDegrees, eased);
  camera.updateProjectionMatrix();
}
