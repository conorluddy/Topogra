import { createTerrainElevationMaterial } from './terrain-elevation-material';
import {
  interpolateElevationGradient,
  type ElevationGradientSettings,
} from './terrain-elevation-gradient';
import {
  landFinishes,
  waterFinishes,
  type LandFinish,
  type WaterFinish,
} from './terrain-materials';
import { createNaturalTerrainMaterial, createTerrainDepths } from './terrain-natural-material';
import {
  createContourEngraving,
  defaultContourEngraving,
  type ContourEngravingSettings,
} from './terrain-contour-engraving';
import { createTerraceContours, type TerrainTerraceLevels } from './terrain-terraces';
import { sampleHeightField } from './terrain-surface';
import { createWaterVolume } from './terrain-water-volume';
import { createTerrainStage, defaultTerrainGroundColor } from './terrain-stage';
import type { FrameFinish } from './frame/frame-studio-settings';
import { createTerrainFramePreview } from './terrain-frame-preview';
import type { FramePart } from './types/frame';
import type { FloorPlace } from './floor-geo';
import type { FloorStyle } from './terrain-floor-styles';
import { getTerrainWaterColor } from './terrain-water';
import {
  defaultTerrainLighting,
  getTerrainAtmosphere,
  type TerrainLightingSettings,
} from './terrain-lighting';
import { createTerrainLineBuffers } from './terrain-3d-lines';
import { createTerrainRoadLayer } from './terrain-3d-roads';
import {
  createTerrainRouteLayer,
  noRouteOverlay,
  type TerrainRouteOverlay,
} from './terrain-3d-route';
import { createDisplayedSurface, type DisplayedSurface } from './terrain-3d-route-drape';
import type { FramePoint } from './real-terrain-projection';
import { createTerrainGrassLayer } from './terrain-3d-grass';
import { getGrassRoads, type GrassGeography, type GrassSite } from './grass-coverage';
import type { GrassStyle } from './types/grass';
import { defaultRoadStyle } from './constants/roads';
import { noRoadPaths } from './road-ribbons';
import {
  baseTerrainFovDegrees,
  defaultTerrainCameraSettings,
  getBokehAperture,
  getCompensatedDistance,
  getDistanceForHalfHeight,
  getOrthographicHalfHeight,
  getVerticalFovDegrees,
  terrainViewPresets,
  type CameraPose,
  type TerrainCameraSettings,
  type TerrainViewPreset,
} from './terrain-camera';
import { getStillPixelRatio } from './export/still-export';
import { createTerrainMeshMorph, type TerrainMeshMorph } from './terrain-3d-transition';
import { evaluateTerrainTransition } from './terrain-transition';
import { terrainTransitionDurationMs } from './constants/terrain-transition';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { terrain3dElevationScale } from './terrain-surface';
import {
  createTerrainModel,
  defaultHeightExaggeration,
  defaultTerrainModelSettings,
  getFrameUnitsPerMm,
  type TerrainModelSettings,
  type TerrainModel,
} from './terrain-model';
import { createBinaryStl } from './export/stl-export';
import type { HeightField } from './types/terrain';
import { seaLevelHatchSpacing, seaLevelHatchOpacity } from './constants/sea-level';
import type { SeaLevelGeometry } from './sea-level';
import * as THREE from 'three';
import {
  advanceCameraShotPlayback,
  cameraShotMoveMs,
  interpolateCameraShot,
  type CameraShot,
  type CameraShotPlayback,
} from './terrain-camera-shots';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createTerrainThrowables } from './throwables/throwables';
import { createTerrainWalk } from './terrain-walk';
import { createTerrainTransitionAudio } from './terrain-transition-audio';
import { createTerrainPostProcessing, type TerrainPostProcessing } from './terrain-post-processing';
import type { Contour } from './types/contours';
import type { DesignSettings } from './types/design';
import type { RoadPath, RoadStyle } from './types/roads';

export type WaterStyle = 'hatched' | 'solid' | 'off';

/** An optional, session-only raised-contour preview of the shared landscape. */
export interface Terrain3d {
  update(
    contours: Contour[],
    width: number,
    height: number,
    settings: DesignSettings,
    field: HeightField,
    seaLevel?: SeaLevelGeometry,
    terraceLevels?: TerrainTerraceLevels,
    roads?: readonly RoadPath[],
    grassGeography?: GrassGeography,
    route?: TerrainRouteOverlay,
  ): void;
  setVisible(value: boolean): void;
  /** Pass false when a terrain update follows, so the new height morphs with it. */
  setHeight(value: number, shouldRebuild?: boolean): void;
  setModelSettings(value: TerrainModelSettings): void;
  /** Shows frame parts around the model and lifts the model onto `seatHeightMm`. */
  setFrame(parts: readonly FramePart[], seatHeightMm: number, finish: FrameFinish): void;
  getStl(): ArrayBuffer;
  setLandFinish(value: LandFinish): void;
  setElevationGradient(value: ElevationGradientSettings): void;
  setWaterFinish(value: WaterFinish): void;
  setWaterOpacity(value: number): void;
  setPreviewWaterLevel(value: number | undefined): void;
  setSurface(value: boolean): void;
  setBase(value: boolean): void;
  setGround(value: boolean): void;
  setGroundColor(value: string | undefined): void;
  setMapGrid(
    value: boolean,
    place: FloorPlace | undefined,
    contourIntervalMeters: number | undefined,
    floorStyle: FloorStyle,
  ): void;
  setWaterStyle(value: WaterStyle): void;
  setWaterColor(value: string | undefined): void;
  setContours(value: boolean): void;
  setRoadStyle(value: Readonly<RoadStyle>): void;
  setGrassStyle(value: Readonly<GrassStyle>): void;
  setContourEngraving(value: ContourEngravingSettings): void;
  setSurfaceColor(value: string | undefined): void;
  setRotating(value: boolean): void;
  setRotationSpeed(value: number): void;
  applyViewPreset(preset: TerrainViewPreset): void;
  setCameraDirection(azimuthDegrees: number, elevationDegrees: number): void;
  /** Waits for a click on the terrain; resolves false if cancelled with Escape or a miss. */
  pickFocus(): Promise<boolean>;
  /** Renders the current view at `scale` × its on-screen CSS size into a new 2D canvas. */
  captureStill(scale: number): HTMLCanvasElement;
  setLighting(settings: Readonly<TerrainLightingSettings>): void;
  setCamera(settings: Readonly<TerrainCameraSettings>): void;
  /** Morphs the next rebuilt landscape from the current one instead of cutting to it. */
  requestTransition(): void;
  reset(): void;
  getCameraPose(): CameraPose;
  /** The terrain point under a viewport position, as fractions across the model (0,0 = north-west). */
  getSurfaceFractionAt(clientX: number, clientY: number): { x: number; y: number } | undefined;
  /** Shows the profile-inspection marker at a crop-unit point on the route; never rebuilds it. */
  setRouteMarker(point: FramePoint | undefined): void;
  /**
   * Viewport (client) pixels of a crop-unit point on the displayed surface; undefined off the
   * model, before a terrain update, or behind the camera.
   */
  projectCropPointToClient(point: FramePoint): { clientX: number; clientY: number } | undefined;
  /** Spike: walks from the terrain under a viewport point, or the orbit centre when omitted; false on a miss. */
  walkAt(metersPerUnit: number, clientX?: number, clientY?: number): boolean;
  /** Runs after every drawn frame (orbit, presets, turntable, rebuilds); returns an unsubscribe. */
  subscribeDraw(listener: () => void): () => void;
  /** The current view and a small preview drawn from it; undefined while walking. */
  captureCameraShot(): { shot: CameraShot; thumbnailUrl: string } | undefined;
  /** False while walking, when the camera stays put. */
  flyToCameraShot(shot: CameraShot): boolean;
  /**
   * Tours the shots in a loop until stopped; `onStop` runs however playback ends, e.g. on a drag.
   * False while walking, when nothing starts.
   */
  playCameraShots(shots: readonly CameraShot[], onStop: () => void): boolean;
  stopCameraShots(): void;
}

type GradientRange = readonly [minimum: number, maximum: number];

/** A landscape morph in progress; decorations that cannot follow the mesh fade or hide. */
interface RunningTerrainTransition {
  startedAtMs: number;
  morph: TerrainMeshMorph;
  outgoingContours: LineSegments2[];
  outgoingStrokeOpacity: number;
  previousGradientRange: GradientRange;
  previousGradient?: ElevationGradientSettings;
  incomingOpacity: number;
}

export function createTerrain3d(
  onModel: (heightMm: number, layerHeightMm?: number) => void = () => undefined,
  /** Runs after every drawn frame, so camera readouts can follow orbits, presets and the turntable. */
  onDraw: () => void = () => undefined,
  /** Spike: first-person walking started or stopped. */
  onWalkChange: (isWalking: boolean) => void = () => undefined,
): Terrain3d {
  const renderer = new THREE.WebGLRenderer({ antialias: true });

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.domElement.className = 'terrain-3d';
  renderer.domElement.dataset.terrainTransition = 'settled';
  renderer.domElement.setAttribute(
    'aria-label',
    'Interactive 3D terrain. Drag to orbit; scroll to zoom.',
  );
  const viewport = document.querySelector('#studio-viewport') ?? document.body;

  viewport.append(renderer.domElement);
  const scene = new THREE.Scene();
  const perspectiveCamera = new THREE.PerspectiveCamera(
    getVerticalFovDegrees(defaultTerrainCameraSettings.focalLengthMm),
    1,
    0.01,
    200,
  );
  const orthographicCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 200);
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspectiveCamera;
  let viewportAspect = 1;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let orthographicHalfHeight = 1;
  const controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(
    camera,
    renderer.domElement,
  );

  controls.maxPolarAngle = Math.PI * 0.49;
  const lineLayers = {
    ordinary: new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({ transparent: true, depthWrite: false }),
    ),
    solid: new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({ transparent: true, depthWrite: false }),
    ),
    dashed: new LineSegments2(
      new LineSegmentsGeometry(),
      new LineMaterial({ transparent: true, depthWrite: false, dashed: true }),
    ),
  };
  const contourLayer = new THREE.Group();

  contourLayer.add(...Object.values(lineLayers));
  const transitionAudio = createTerrainTransitionAudio();
  let isTransitionArmed = false;
  let transition: RunningTerrainTransition | undefined;
  let pendingMapGrid: Parameters<Terrain3d['setMapGrid']> | undefined;
  // Like the map grid, a gradient arriving with a terrain change waits to blend with the morph.
  let targetGradient: ElevationGradientSettings | undefined;
  let shownGradient: ElevationGradientSettings | undefined;

  const showGradient = (value: ElevationGradientSettings) => {
    elevationGradient.setSettings(value);
    shownGradient = value;
  };

  const showTargetGradient = () => {
    if (targetGradient && targetGradient !== shownGradient) {
      showGradient(targetGradient);
    }
  };

  let strokeOpacity = 1;
  // Engraving and water are built for the destination, so they wait for the incoming fade.
  const shouldHideDecorations = () => transition?.incomingOpacity === 0;
  let customSurfaceColor: string | undefined;
  let backgroundColor = '#202326';
  let customGroundColor: string | undefined = defaultTerrainGroundColor;

  const surfaceMaterial = new THREE.MeshPhysicalMaterial({
    color: backgroundColor,
    roughness: 1,
    metalness: 0,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 2,
    polygonOffsetUnits: 2,
  });
  const engraving = createContourEngraving();
  let contourTreatment = defaultContourEngraving.treatment;
  let showContours = true;

  engraving.applyTo(surfaceMaterial);
  const naturalSurfaceMaterial = createNaturalTerrainMaterial(false);
  // Every finish and gradient keeps the layered-earth cut edges; only the land surface changes.
  const baseMaterial = createNaturalTerrainMaterial(true);
  let landFinish: LandFinish = 'natural';

  engraving.applyTo(naturalSurfaceMaterial);
  const elevationGradient = createTerrainElevationMaterial();

  for (const material of [surfaceMaterial, naturalSurfaceMaterial]) {
    elevationGradient.applyTo(material);
  }

  const updateLandColor = () => {
    surfaceMaterial.color.set(customSurfaceColor ?? backgroundColor);
    naturalSurfaceMaterial.color.set(customSurfaceColor ?? '#ffffff');
    // A dark preset colour would bury the rock layers, so only the natural tint reaches them.
    baseMaterial.color.set(
      landFinish === 'natural' ? (customSurfaceColor ?? '#ffffff') : '#ffffff',
    );
  };

  const surface = new THREE.Mesh(new THREE.BufferGeometry(), surfaceMaterial);
  const base = new THREE.Mesh(new THREE.BufferGeometry(), baseMaterial);

  const syncContourTreatment = () => {
    contourLayer.visible = showContours && (contourTreatment === 'drawn' || !surface.visible);
    engraving.setEnabled(
      showContours &&
        contourTreatment === 'engraved' &&
        surface.visible &&
        !shouldHideDecorations(),
    );
  };

  surface.castShadow = surface.receiveShadow = true;
  base.castShadow = base.receiveShadow = true;
  base.visible = true;
  let solidBase = true;
  let showGround = true;
  const stage = createTerrainStage();

  const backdropTint = new THREE.Color(1, 1, 1);

  const updateStageVisibility = () => {
    const enabled = showGround;

    stage.setVisible(enabled);
    scene.background = new THREE.Color(
      enabled ? (customGroundColor ?? backgroundColor) : backgroundColor,
    ).multiply(backdropTint);
  };

  scene.add(stage.group);
  updateStageVisibility();
  const sunlight = new THREE.DirectionalLight(0xfff4df, defaultTerrainLighting.intensity);
  const fillLight = new THREE.HemisphereLight(0xe8f0ff, 0x36382c, defaultTerrainLighting.fill);

  sunlight.castShadow = true;
  sunlight.shadow.mapSize.set(2048, 2048);
  sunlight.shadow.camera.left = sunlight.shadow.camera.bottom = -4;
  sunlight.shadow.camera.right = sunlight.shadow.camera.top = 4;
  sunlight.shadow.camera.near = 0.1;
  sunlight.shadow.camera.far = 40;
  sunlight.shadow.normalBias = 0.005;
  sunlight.shadow.bias = -0.0001;
  sunlight.shadow.radius = 3;

  let lighting: Readonly<TerrainLightingSettings> = defaultTerrainLighting;
  let exposureScale = 1;
  let landscapeRadius = 1;

  /** Positions the sun independently of the camera; time of day sets height, colour and studio tint. */
  const applyLighting = () => {
    const atmosphere = getTerrainAtmosphere(lighting.timeOfDay);
    const direction = THREE.MathUtils.degToRad(lighting.direction);
    const elevation = THREE.MathUtils.degToRad(atmosphere.sunElevation);
    const radius = 10;

    sunlight.position.set(
      radius * Math.cos(elevation) * Math.sin(direction),
      radius * Math.sin(elevation),
      -radius * Math.cos(elevation) * Math.cos(direction),
    );
    sunlight.color.set(atmosphere.sunColor);
    sunlight.intensity = lighting.flat
      ? 0
      : lighting.intensity * atmosphere.sunScale * exposureScale;
    stage.setCastShadows(!lighting.flat && lighting.intensity > 0);
    fillLight.color.set(atmosphere.skyColor);
    fillLight.groundColor.set(atmosphere.groundColor);
    fillLight.intensity = lighting.fill * atmosphere.fillScale * exposureScale;
    backdropTint.set(atmosphere.tint);
    stage.setTint(atmosphere.tint);
    updateStageVisibility();
  };

  /** Haze is relative to the model, so it reads the same at any lens or zoom. */
  const updateFog = () => {
    if (lighting.haze <= 0) {
      scene.fog = null;

      return;
    }

    const fog = scene.fog instanceof THREE.Fog ? scene.fog : new THREE.Fog(0xffffff);
    const distance = camera.position.distanceTo(controls.target);
    // The far edge of the model reaches 85% haze at full strength.
    const backEdgeHaze = lighting.haze * 0.85;

    scene.fog = fog;
    fog.color.copy(scene.background instanceof THREE.Color ? scene.background : backdropTint);
    fog.near = Math.max(0, distance - landscapeRadius);
    fog.far = fog.near + (2 * landscapeRadius) / backEdgeHaze;
  };

  applyLighting();
  scene.add(fillLight, sunlight);
  let modelSettings: TerrainModelSettings = { ...defaultTerrainModelSettings };
  let exaggeration = defaultHeightExaggeration;
  let model: TerrainModel | undefined;
  let modelKey = '';
  let terracedContours: Contour[] | undefined;
  let displayedSurface: DisplayedSurface | undefined;
  let waterSurfacePositions: Float32Array = new Float32Array();
  let lastUpdate: Parameters<Terrain3d['update']> | undefined;
  let gradientRange: GradientRange = [0, 1];

  const rebuild = () => {
    if (lastUpdate) {
      api.update(...lastUpdate);
    }
  };

  let previousField: HeightField | undefined;

  const seaInk = new THREE.Color();
  const seaMaterial = new THREE.ShaderMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    uniforms: {
      ink: { value: seaInk },
      spacing: { value: seaLevelHatchSpacing * Math.SQRT2 },
      opacity: { value: seaLevelHatchOpacity },
    },
    vertexShader: `varying vec2 mapPosition;
      void main() {
        mapPosition = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform vec3 ink; uniform float spacing; uniform float opacity; varying vec2 mapPosition;
      void main() {
        float phase = abs(mod(mapPosition.x + mapPosition.y + spacing * 0.5, spacing) - spacing * 0.5);
        float edge = max(fwidth(phase), 0.001);
        float stripe = 1.0 - smoothstep(spacing * 0.25 - edge * 0.5, spacing * 0.25 + edge * 0.5, phase);
        gl_FragColor = vec4(ink, stripe * opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const solidWaterMaterial = new THREE.MeshBasicMaterial({
    color: getTerrainWaterColor(backgroundColor),
    side: THREE.DoubleSide,
  });
  const litWaterMaterial = new THREE.MeshPhysicalMaterial({
    side: THREE.DoubleSide,
    metalness: 0,
    clearcoatRoughness: 0.12,
  });
  let waterOpacity = 0.4;
  let previewWaterLevel: number | undefined;
  let waterFinish: WaterFinish = 'graphic';
  const activeWaterMaterial = () =>
    waterFinish === 'graphic' ? solidWaterMaterial : litWaterMaterial;
  let waterStyle: WaterStyle = 'solid';
  let customWaterColor: string | undefined;

  const updateWaterColor = () => {
    const color = customWaterColor ?? getTerrainWaterColor(customSurfaceColor ?? backgroundColor);

    solidWaterMaterial.color.set(color);
    litWaterMaterial.color.set(color);
  };

  const sea = new THREE.Mesh<THREE.BufferGeometry, THREE.Material>(
    new THREE.BufferGeometry(),
    seaMaterial,
  );
  const waterSides = new THREE.Mesh(new THREE.BufferGeometry(), litWaterMaterial);

  const syncWater = () => {
    sea.visible =
      waterStyle !== 'off' &&
      !shouldHideDecorations() &&
      sea.geometry.hasAttribute('position') &&
      sea.geometry.getAttribute('position').count > 0;
    waterSides.visible = sea.visible && waterFinish === 'translucent' && waterStyle === 'solid';
  };

  const landscape = new THREE.Group();

  const roads = createTerrainRoadLayer();
  const route = createTerrainRouteLayer();
  const grass = createTerrainGrassLayer();
  let roadStyle: Readonly<RoadStyle> = defaultRoadStyle;
  let grassTerrain:
    | {
        field: HeightField;
        width: number;
        height: number;
        seaLevel: number | undefined;
        roadPaths: readonly RoadPath[];
        geography: GrassGeography;
      }
    | undefined;
  let grassRoads: { key: readonly unknown[]; roads: GrassSite['roads'] } = { key: [], roads: [] };

  /** Regrows grass from the last terrain update and the current road style. */
  const updateGrass = () => {
    if (!grassTerrain) {
      grass.update(undefined);

      return;
    }

    const { field, width, height, seaLevel, roadPaths, geography } = grassTerrain;
    const frameUnitsPerMm = getFrameUnitsPerMm(width, height, modelSettings);
    const roadKey = [
      roadPaths,
      roadStyle.enabled,
      roadStyle.detail,
      roadStyle.widthMm,
      frameUnitsPerMm,
    ];

    // A stable road list keeps grass from resurveying the ground on unrelated updates.
    if (roadKey.some((value, index) => value !== grassRoads.key[index])) {
      grassRoads = { key: roadKey, roads: getGrassRoads(roadPaths, roadStyle, frameUnitsPerMm) };
    }

    grass.update({
      site: {
        field,
        width,
        height,
        shape: modelSettings.cropShape ?? 'rectangle',
        frameUnitsPerMm,
        seaLevel,
        roads: grassRoads.roads,
        ...geography,
      },
      surface: surface.geometry,
    });
    updateLoop();
  };

  landscape.add(surface, base, contourLayer, roads.mesh, route.object, grass.mesh, sea, waterSides);
  scene.add(landscape);
  const framePreview = createTerrainFramePreview(renderer);

  /** Scene units per millimetre: the model's longest side spans two units. */
  const getPreviewScale = () =>
    2 /
    (modelSettings.cropShape === 'circle'
      ? modelSettings.widthMm
      : Math.max(modelSettings.widthMm, modelSettings.lengthMm));

  scene.add(framePreview.group);
  let visible = false;
  let rotating = false;
  let previousTime = performance.now();

  let cameraSettings: Readonly<TerrainCameraSettings> = defaultTerrainCameraSettings;
  let postProcessing: TerrainPostProcessing | undefined;
  let pickedFocusPoint: THREE.Vector3 | undefined;
  /** Resolves a pending focus pick as cancelled, removing its listeners. */
  let cancelFocusPick: (() => void) | undefined;

  /** Depth of field relies on perspective depth, so orthographic views skip it. */
  const getActiveFocusEffect = () =>
    cameraSettings.focusEffect === 'depth-of-field' && camera === orthographicCamera
      ? 'off'
      : cameraSettings.focusEffect;

  const getFocusDistance = () => {
    const point =
      cameraSettings.focusFollowsTarget || !pickedFocusPoint ? controls.target : pickedFocusPoint;

    camera.updateMatrixWorld();

    return -point.clone().applyMatrix4(camera.matrixWorldInverse).z;
  };

  const drawListeners = new Set<() => void>();

  const draw = () => {
    if (visible && !document.hidden) {
      render();
      onDraw();

      for (const listener of drawListeners) {
        listener();
      }
    }
  };

  const render = () => {
    updateFog();

    if (postProcessing && getActiveFocusEffect() !== 'off') {
      postProcessing.setDepthOfField(
        getFocusDistance(),
        getBokehAperture(cameraSettings.apertureFStop),
      );
      postProcessing.render();
    } else {
      renderer.render(scene, camera);
    }
  };

  const syncPostProcessing = () => {
    if (cameraSettings.focusEffect === 'off' && !postProcessing) {
      return;
    }

    postProcessing ??= createTerrainPostProcessing(renderer, scene, camera, [contourLayer]);
    postProcessing.setSize(viewportWidth, viewportHeight, renderer.getPixelRatio());
    postProcessing.setCamera(camera);
    postProcessing.setEffect(getActiveFocusEffect());
    postProcessing.setTiltShift({
      bandPosition: cameraSettings.tiltShiftPosition,
      bandWidth: cameraSettings.tiltShiftWidth,
      blur: cameraSettings.tiltShiftBlur,
    });
  };

  controls.addEventListener('change', draw);
  // Grabbing the camera takes it back from a shot tour.
  controls.addEventListener('start', () => stopCameraShots?.());

  const resize = () => {
    const width = Math.max(1, viewport.clientWidth);
    const height = Math.max(1, viewport.clientHeight);

    renderer.setSize(width, height);
    viewportWidth = width;
    viewportHeight = height;
    postProcessing?.setSize(width, height, renderer.getPixelRatio());
    viewportAspect = width / height;
    perspectiveCamera.aspect = viewportAspect;
    perspectiveCamera.updateProjectionMatrix();
    updateOrthographicFrustum();
    draw();
  };

  const updateOrthographicFrustum = () => {
    orthographicCamera.top = orthographicHalfHeight;
    orthographicCamera.bottom = -orthographicHalfHeight;
    orthographicCamera.left = -orthographicHalfHeight * viewportAspect;
    orthographicCamera.right = orthographicHalfHeight * viewportAspect;
    orthographicCamera.updateProjectionMatrix();
  };

  /** Perspective-equivalent distance, so framing survives lens and projection changes. */
  const getViewDistance = () =>
    camera === orthographicCamera
      ? getDistanceForHalfHeight(orthographicHalfHeight, perspectiveCamera.fov) /
        orthographicCamera.zoom
      : perspectiveCamera.position.distanceTo(controls.target);

  /** Places the active camera along `direction` from the orbit target at a framing distance. */
  const placeCamera = (direction: THREE.Vector3, distance: number) => {
    const scale = getCompensatedDistance(1, baseTerrainFovDegrees, perspectiveCamera.fov);
    const minDistance = 0.5 * scale;
    const maxDistance = 12 * scale;
    const offset = direction.clone().normalize();

    controls.minDistance = minDistance;
    controls.maxDistance = maxDistance;

    if (camera === orthographicCamera) {
      // Orthographic depth does not affect framing; a fixed standoff keeps the model unclipped.
      orthographicHalfHeight = getOrthographicHalfHeight(distance, perspectiveCamera.fov);
      orthographicCamera.zoom = 1;
      controls.minZoom = distance / maxDistance;
      controls.maxZoom = distance / minDistance;
      orthographicCamera.position.copy(controls.target).addScaledVector(offset, maxDistance);
      updateOrthographicFrustum();
    } else {
      perspectiveCamera.position.copy(controls.target).addScaledVector(offset, distance);
    }

    controls.update();
  };

  const setCameraSettings = (settings: Readonly<TerrainCameraSettings>) => {
    const direction = camera.position.clone().sub(controls.target);
    const distance = getCompensatedDistance(
      getViewDistance(),
      perspectiveCamera.fov,
      getVerticalFovDegrees(settings.focalLengthMm),
    );

    perspectiveCamera.fov = getVerticalFovDegrees(settings.focalLengthMm);
    perspectiveCamera.updateProjectionMatrix();
    exposureScale = 2 ** settings.exposureEv;
    applyLighting();
    camera = settings.projection === 'orthographic' ? orthographicCamera : perspectiveCamera;
    controls.object = camera;
    placeCamera(direction, distance);
    cameraSettings = settings;
    syncPostProcessing();
    draw();
  };

  let viewAnimationFrame = 0;
  /** Jumps a running preset animation to its destination; undefined when the camera is settled. */
  let settleViewAnimation: (() => void) | undefined;

  /** Eases the camera to a new direction around the target, keeping the framing distance. */
  const animateCameraDirection = (direction: THREE.Vector3) => {
    // A new preset eases on from wherever the previous one had reached.
    cancelAnimationFrame(viewAnimationFrame);
    const distance = getViewDistance();
    const from = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    const to = new THREE.Spherical().setFromVector3(direction);
    const thetaChange =
      THREE.MathUtils.euclideanModulo(to.theta - from.theta + Math.PI, Math.PI * 2) - Math.PI;
    const durationMs = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 400;
    const startedAt = performance.now();

    const step = () => {
      const progress =
        durationMs === 0 ? 1 : Math.min(1, (performance.now() - startedAt) / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      const current = new THREE.Spherical(
        1,
        THREE.MathUtils.lerp(from.phi, to.phi, eased),
        from.theta + thetaChange * eased,
      );

      placeCamera(new THREE.Vector3().setFromSpherical(current), distance);
      draw();

      if (progress < 1) {
        viewAnimationFrame = requestAnimationFrame(step);
      } else {
        settleViewAnimation = undefined;
      }
    };

    settleViewAnimation = () => {
      cancelAnimationFrame(viewAnimationFrame);
      settleViewAnimation = undefined;
      placeCamera(direction, distance);
    };

    step();
  };

  /** Ends a running shot flight or tour; undefined while none runs. */
  let stopCameraShots: (() => void) | undefined;

  const getCameraShot = (): CameraShot => {
    const { x, y, z } = camera.position.clone().sub(controls.target).normalize();
    const { x: targetX, y: targetY, z: targetZ } = controls.target;

    return {
      target: { x: targetX, y: targetY, z: targetZ },
      direction: { x, y, z },
      distance: getViewDistance(),
    };
  };

  const placeCameraShot = ({ target, direction, distance }: CameraShot) => {
    controls.target.set(target.x, target.y, target.z);
    placeCamera(new THREE.Vector3(direction.x, direction.y, direction.z), distance);
    draw();
  };

  /** Eases through `shots` from the current view; holds between them and loops when asked. */
  const runCameraShots = (
    shots: readonly CameraShot[],
    shouldLoop: boolean,
    onStop: () => void = () => undefined,
  ) => {
    stopCameraShots?.();
    settleViewAnimation?.();
    // Reduced motion cuts between shots; the hold still paces the tour.
    const moveMs = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : cameraShotMoveMs;
    let from = getCameraShot();
    let playback: CameraShotPlayback = { kind: 'moving', index: 0, startedAtMs: performance.now() };
    let frame = 0;

    const stop = () => {
      cancelAnimationFrame(frame);
      stopCameraShots = undefined;
      controls.autoRotate = rotating;
      onStop();
    };

    const step = () => {
      const now = performance.now();
      const next = advanceCameraShotPlayback(playback, now, shots.length, moveMs);

      if (playback.kind === 'moving' && next.kind !== 'moving') {
        from = shots[playback.index];
        placeCameraShot(from);

        if (!shouldLoop && playback.index === shots.length - 1) {
          stop();

          return;
        }
      }

      playback = next;

      if (playback.kind === 'moving') {
        // A zero-length move (reduced motion) would divide by zero.
        const progress = moveMs === 0 ? 1 : (now - playback.startedAtMs) / moveMs;

        placeCameraShot(interpolateCameraShot(from, shots[playback.index], progress));
      }

      frame = requestAnimationFrame(step);
    };

    // The turntable would fight the tour for the camera.
    controls.autoRotate = false;
    stopCameraShots = stop;
    step();
  };

  const raycaster = new THREE.Raycaster();

  const getTerrainPointAt = (clientX: number, clientY: number) => {
    const bounds = renderer.domElement.getBoundingClientRect();

    raycaster.setFromCamera(
      new THREE.Vector2(
        ((clientX - bounds.left) / bounds.width) * 2 - 1,
        -((clientY - bounds.top) / bounds.height) * 2 + 1,
      ),
      camera,
    );

    return raycaster.intersectObjects([surface, base], false).find((hit) => hit.object.visible)
      ?.point;
  };

  /** Double-click re-centres the orbit on a terrain point without changing the viewing angle. */
  renderer.domElement.addEventListener('dblclick', (event) => {
    const point = getTerrainPointAt(event.clientX, event.clientY);

    if (!point) {
      return;
    }

    const offset = camera.position.clone().sub(controls.target);

    controls.target.copy(point);
    camera.position.copy(point).add(offset);
    controls.update();
    draw();
  });

  // Spike: first person drops in at a terrain point; Esc returns to the saved orbit pose.
  const downRay = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  let orbitPose: { position: THREE.Vector3; target: THREE.Vector3 } | undefined;

  const getGroundHeight = (x: number, z: number) => {
    downRay.ray.origin.set(x, 50, z);

    return downRay.intersectObject(surface, false)[0]?.point.y;
  };

  const throwables = createTerrainThrowables({ scene, camera: perspectiveCamera, getGroundHeight });
  const walk = createTerrainWalk({
    camera: perspectiveCamera,
    canvas: renderer.domElement,
    getGroundHeight,
    toy: throwables,
    onFrame: draw,
    onStop() {
      if (orbitPose) {
        camera =
          cameraSettings.projection === 'orthographic' ? orthographicCamera : perspectiveCamera;
        controls.object = camera;
        perspectiveCamera.position.copy(orbitPose.position);
        controls.target.copy(orbitPose.target);
      }

      controls.enabled = visible;
      controls.update();
      postProcessing?.setCamera(camera);
      draw();
      onWalkChange(false);
    },
  });

  /** Flies down into first person at a world point; false when hidden or already walking. */
  const startWalk = (dropPoint: THREE.Vector3, metersPerUnit: number): boolean => {
    if (!visible || walk.isWalking) {
      return false;
    }

    settleViewAnimation?.();
    controls.enabled = false;

    // The flight starts from where the orthographic view appears to be.
    if (camera === orthographicCamera) {
      perspectiveCamera.position
        .copy(controls.target)
        .addScaledVector(
          orthographicCamera.position.clone().sub(controls.target).normalize(),
          getViewDistance(),
        );
      perspectiveCamera.lookAt(controls.target);
    }

    orbitPose = { position: perspectiveCamera.position.clone(), target: controls.target.clone() };
    camera = perspectiveCamera;
    postProcessing?.setCamera(camera);
    stopCameraShots?.();
    onWalkChange(true);
    walk.start({ x: dropPoint.x, z: dropPoint.z }, metersPerUnit);

    return true;
  };

  const reset = () => {
    stopCameraShots?.();
    const home = new THREE.Vector3(0, 2.1, 2.5);

    controls.target.set(0, 0, 0);
    placeCamera(
      home,
      getCompensatedDistance(home.length(), baseTerrainFovDegrees, perspectiveCamera.fov),
    );
    draw();
  };

  const updateLoop = () => {
    // Without a running wind, blades stand upright rather than keeping the last gust's lean.
    grass.setSettled(!grass.isAnimated());
    renderer.setAnimationLoop(
      visible && (rotating || transition !== undefined || grass.isAnimated()) && !document.hidden
        ? () => {
            const now = performance.now();

            if (rotating) {
              controls.update(Math.min((now - previousTime) / 1000, 0.05));
            }

            previousTime = now;
            grass.tick(now);
            advanceTransition(now);
            draw();
          }
        : null,
    );
  };

  /** Test hooks: what the route layer drew, on the canvas wrapper like `data-terrain-transition`. */
  const syncRouteHooks = () => {
    const { points, waypoints, markers, builds } = route.getCounts();
    const { dataset } = renderer.domElement;

    dataset.routeBuilds = String(builds);

    if (points === 0) {
      delete dataset.routePoints;
      delete dataset.routeWaypoints;
      delete dataset.routeMarker;

      return;
    }

    dataset.routePoints = String(points);
    dataset.routeWaypoints = String(waypoints);
    dataset.routeMarker = markers > 0 ? 'visible' : 'none';
  };

  const syncDecorations = () => {
    const opacity = strokeOpacity * (transition?.incomingOpacity ?? 1);

    for (const layer of Object.values(lineLayers)) {
      layer.material.opacity = opacity;
    }

    syncContourTreatment();
    syncWater();
    roads.setSuppressed(shouldHideDecorations() || modelSettings.terrainShape === 'terraced');
    route.setSuppressed(shouldHideDecorations());
    syncRouteHooks();
    const wasAnimated = grass.isAnimated();

    grass.setSuppressed(shouldHideDecorations() || modelSettings.terrainShape === 'terraced');

    // Wind keeps the loop running, so showing or hiding grass starts or stops it.
    if (grass.isAnimated() !== wasAnimated) {
      updateLoop();
    }
  };

  const applyPendingMapGrid = () => {
    if (pendingMapGrid) {
      stage.setMapGrid(...pendingMapGrid);
      pendingMapGrid = undefined;
    }
  };

  /** Hands the previous meshes to a morph that ends on the freshly built destination geometry. */
  const startTransition = (
    previousSurface: THREE.BufferGeometry,
    previousBase: THREE.BufferGeometry,
    previousGradientRange: GradientRange,
  ) => {
    const morph = createTerrainMeshMorph([
      { previous: previousSurface, next: surface.geometry },
      { previous: previousBase, next: base.geometry },
    ]);

    previousSurface.dispose();
    previousBase.dispose();

    if (!morph) {
      return;
    }

    const outgoingContours: LineSegments2[] = [];

    for (const layer of Object.values(lineLayers)) {
      if (layer.visible) {
        const outgoing = new LineSegments2(layer.geometry, layer.material.clone());

        layer.geometry = new LineSegmentsGeometry();
        outgoingContours.push(outgoing);
        contourLayer.add(outgoing);
      }
    }

    transition = {
      startedAtMs: performance.now(),
      morph,
      outgoingContours,
      outgoingStrokeOpacity: strokeOpacity,
      previousGradientRange,
      previousGradient: shownGradient,
      incomingOpacity: 0,
    };
    // Bounds lag the morphing vertices, so culling could drop terrain or its shadow mid-blend.
    surface.frustumCulled = base.frustumCulled = false;
    advanceTransition(transition.startedAtMs);
    renderer.domElement.dataset.terrainTransition = 'morphing';
    transitionAudio.play();
    updateLoop();
  };

  const advanceTransition = (nowMs: number) => {
    if (!transition) {
      return;
    }

    const frame = evaluateTerrainTransition(
      nowMs - transition.startedAtMs,
      terrainTransitionDurationMs,
    );

    if (frame.isComplete) {
      finishTransition();

      return;
    }

    const progress = frame.terrainProgress;
    const [fromMinimum, fromMaximum] = transition.previousGradientRange;
    const [toMinimum, toMaximum] = gradientRange;

    transition.morph.apply(progress);
    elevationGradient.setRange(
      (1 - progress) * fromMinimum + progress * toMinimum,
      (1 - progress) * fromMaximum + progress * toMaximum,
    );

    const { previousGradient } = transition;

    if (
      previousGradient?.enabled === true &&
      targetGradient?.enabled === true &&
      previousGradient !== targetGradient
    ) {
      showGradient(interpolateElevationGradient(previousGradient, targetGradient, progress));
    } else {
      showTargetGradient();
    }

    for (const line of transition.outgoingContours) {
      line.material.opacity = transition.outgoingStrokeOpacity * frame.outgoingOpacity;
    }

    transition.incomingOpacity = frame.incomingOpacity;
    syncDecorations();
  };

  /** Lands exactly on the destination; also used to cut short a morph a newer change supersedes. */
  const finishTransition = () => {
    if (!transition) {
      return;
    }

    const { morph, outgoingContours } = transition;

    transition = undefined;
    morph.finish();
    surface.frustumCulled = base.frustumCulled = true;

    for (const line of outgoingContours) {
      contourLayer.remove(line);
      line.geometry.dispose();
      line.material.dispose();
    }

    elevationGradient.setRange(...gradientRange);
    showTargetGradient();
    syncDecorations();
    renderer.domElement.dataset.terrainTransition = 'settled';

    // A queued follow-up morph owns the floor label until it settles too.
    if (!isTransitionArmed) {
      applyPendingMapGrid();
    }

    updateLoop();
  };

  document.addEventListener('visibilitychange', () => {
    previousTime = performance.now();
    updateLoop();
    draw();
  });
  window.addEventListener('pagehide', () => {
    renderer.setAnimationLoop(null);
  });
  window.addEventListener('pageshow', () => {
    previousTime = performance.now();
    updateLoop();
    draw();
  });
  // Grass wind pauses as soon as reduced motion is turned on, not at the next scene edit.
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    updateLoop();
    // A stopped loop draws no more frames, so redraw once to show the settled blades.
    draw();
  });
  new ResizeObserver(resize).observe(viewport);
  resize();
  reset();

  const api: Terrain3d = {
    update(
      contours: Contour[],
      width: number,
      height: number,
      settings: DesignSettings,
      field: HeightField,
      seaLevel?: SeaLevelGeometry,
      terraceLevels?: TerrainTerraceLevels,
      roadPaths: readonly RoadPath[] = noRoadPaths,
      grassGeography?: GrassGeography,
      routeOverlay: TerrainRouteOverlay = noRouteOverlay,
    ) {
      lastUpdate = [
        contours,
        width,
        height,
        settings,
        field,
        seaLevel,
        terraceLevels,
        roadPaths,
        grassGeography,
        routeOverlay,
      ];
      // Terrace levels follow the contour interval but only shape terraced models.
      const morphKey = JSON.stringify([
        width,
        height,
        modelSettings,
        modelSettings.terrainShape === 'terraced' ? terraceLevels : undefined,
      ]);
      const key = `${morphKey}|${exaggeration}`;

      if (field !== previousField || key !== modelKey) {
        // Terraced layers do not share a vertex layout between terrains, so they always cut.
        // Height may change with the location, so it never blocks a morph.
        const shouldMorph =
          isTransitionArmed &&
          modelKey.startsWith(`${morphKey}|`) &&
          previousField !== undefined &&
          modelSettings.terrainShape !== 'terraced';
        const [previousSurface, previousBase] = [surface.geometry, base.geometry];
        const previousGradientRange = gradientRange;

        finishTransition();
        model = createTerrainModel(
          field,
          width,
          height,
          modelSettings,
          exaggeration,
          terraceLevels,
        );
        terracedContours =
          model.contourEdges && terraceLevels
            ? createTerraceContours(
                model.contourEdges,
                contours,
                width,
                height,
                (modelSettings.cropShape === 'circle'
                  ? modelSettings.widthMm
                  : Math.max(modelSettings.widthMm, modelSettings.lengthMm)) / 2,
                terrain3dElevationScale,
                terraceLevels,
              )
            : undefined;
        const gradientOffsetMm = model.elevationOffsetMm;
        const gradientScaleMm = model.elevationScaleMm;
        const previewScale = getPreviewScale();

        for (const [mesh, buffers] of [
          [surface, model.surface],
          [base, model.base],
        ] as const) {
          const geometry = new THREE.BufferGeometry();

          geometry.setAttribute(
            'position',
            new THREE.BufferAttribute(
              Float32Array.from(buffers.positions, (value) => value * previewScale),
              3,
            ),
          );
          geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));

          // Independent face vertices keep the base edges crisp.
          if (mesh === surface) {
            waterSurfacePositions = geometry.getAttribute('position').array as Float32Array;
          }

          const rendered =
            mesh === base || modelSettings.terrainShape === 'terraced'
              ? geometry.toNonIndexed()
              : geometry;

          if (mesh === surface) {
            const positions = rendered.getAttribute('position').array;
            const sourceScale = 2 / Math.max(width, height);
            const elevations = Float32Array.from({ length: positions.length / 3 }, (_, i) =>
              sampleHeightField(
                field,
                positions[i * 3] / sourceScale + width / 2,
                positions[i * 3 + 2] / sourceScale + height / 2,
              ),
            );

            rendered.setAttribute('contourElevation', new THREE.BufferAttribute(elevations, 1));
          }

          const gradientPositions = rendered.getAttribute('position').array;
          const sourceScale = 2 / Math.max(width, height);
          const gradientHeights = Float32Array.from(
            { length: gradientPositions.length / 3 },
            (_, i) =>
              exaggeration > 0
                ? (gradientPositions[i * 3 + 1] / previewScale - gradientOffsetMm) /
                  gradientScaleMm /
                  terrain3dElevationScale
                : sampleHeightField(
                    field,
                    gradientPositions[i * 3] / sourceScale + width / 2,
                    gradientPositions[i * 3 + 2] / sourceScale + height / 2,
                  ),
          );

          rendered.setAttribute('gradientElevation', new THREE.BufferAttribute(gradientHeights, 1));

          rendered.computeVertexNormals();
          rendered.setAttribute(
            'terrainDepth',
            new THREE.BufferAttribute(
              createTerrainDepths(
                mesh === surface
                  ? rendered.getAttribute('position').array
                  : surface.geometry.getAttribute('position').array,
                rendered.getAttribute('position').array,
                mesh === base && model.contourEdges ? (height) => height * 2 : undefined,
              ),
              1,
            ),
          );

          if (rendered !== geometry) {
            geometry.dispose();
          }

          if (!shouldMorph) {
            mesh.geometry.dispose();
          }

          mesh.geometry = rendered;
        }

        let gradientMinimum = Infinity;
        let gradientMaximum = -Infinity;

        for (const elevation of field.values) {
          gradientMinimum = Math.min(gradientMinimum, elevation);
          gradientMaximum = Math.max(gradientMaximum, elevation);
        }

        gradientRange = [gradientMinimum, gradientMaximum];
        elevationGradient.setRange(...gradientRange);
        // Overlays rest on what is drawn, so terraced models hand over their stepped top.
        displayedSurface = createDisplayedSurface({
          field,
          width,
          height,
          modelSettings,
          exaggeration,
          elevationOffset: model.elevationOffsetMm * previewScale,
          terracedSurfaceMm: model.contourEdges ? model.surface : undefined,
        });
        previousField = field;
        modelKey = key;
        onModel(model.overallHeightMm, model.layerHeightMm);

        if (shouldMorph) {
          startTransition(previousSurface, previousBase, previousGradientRange);
        }
      }

      const previewScale = getPreviewScale();

      if (!model || !displayedSurface) {
        throw new Error('Terrain model is unavailable.');
      }

      engraving.update(contours, settings, previewScale);
      const elevationOffset = model.elevationOffsetMm * previewScale;

      roads.update({
        paths: roadPaths,
        field,
        width,
        height,
        modelSettings,
        exaggeration,
        elevationOffset,
      });
      route.update({ ...routeOverlay, surface: displayedSurface });
      syncRouteHooks();
      grassTerrain = grassGeography && {
        field,
        width,
        height,
        seaLevel: seaLevel?.elevation,
        roadPaths,
        geography: grassGeography,
      };
      updateGrass();

      const scale = 2 / Math.max(width, height);

      strokeOpacity = settings.strokeOpacity;
      const lineBuffers = createTerrainLineBuffers(
        terracedContours ?? contours,
        width,
        height,
        settings,
        modelSettings.cropShape,
      );

      for (const buffers of Object.values(lineBuffers)) {
        for (let offset = 1; offset < buffers.positions.length; offset += 3) {
          buffers.positions[offset] =
            (buffers.positions[offset] - 0.0008) * exaggeration + elevationOffset + 0.0008;
        }
      }

      for (const style of ['ordinary', 'solid', 'dashed'] as const) {
        const layer = lineLayers[style];
        const buffers = lineBuffers[style];
        const geometry = new LineSegmentsGeometry();

        if (buffers.positions.length > 0) {
          geometry.setPositions(buffers.positions);
          geometry.setAttribute(
            'instanceDistanceStart',
            new THREE.InstancedBufferAttribute(new Float32Array(buffers.distanceStarts), 1),
          );
          geometry.setAttribute(
            'instanceDistanceEnd',
            new THREE.InstancedBufferAttribute(new Float32Array(buffers.distanceEnds), 1),
          );
        }

        layer.geometry.dispose();
        layer.geometry = geometry;
        layer.visible = buffers.positions.length > 0;
        layer.material.color.set(settings.lineColor);
        layer.material.linewidth =
          style === 'ordinary' ? settings.strokeWidth : settings.indexStrokeWidth;
        layer.material.dashSize = settings.dashLength;
        layer.material.gapSize = settings.dashGap;
      }

      let level = seaLevel?.elevation;

      if (previewWaterLevel !== undefined) {
        let minimum = Infinity;
        let maximum = -Infinity;

        for (const value of field.values) {
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }

        level = minimum + (maximum - minimum) * previewWaterLevel;
      }

      const water =
        level === undefined
          ? { top: [], sides: [] }
          : createWaterVolume(
              waterSurfacePositions,
              model.surface.indices,
              level * terrain3dElevationScale * exaggeration + elevationOffset + 0.00005,
            );
      const seaUvs: number[] = [];

      for (let i = 0; i < water.top.length; i += 3) {
        seaUvs.push(water.top[i] / scale + width / 2, water.top[i + 2] / scale + height / 2);
      }

      for (const [mesh, positions] of [
        [sea, water.top],
        [waterSides, water.sides],
      ] as const) {
        const geometry = new THREE.BufferGeometry();

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        if (mesh === sea) {
          geometry.setAttribute('uv', new THREE.Float32BufferAttribute(seaUvs, 2));
        }

        geometry.computeVertexNormals();
        mesh.geometry.dispose();
        mesh.geometry = geometry;
      }

      syncDecorations();
      isTransitionArmed = false;

      if (!transition) {
        applyPendingMapGrid();
        showTargetGradient();
      }

      seaInk.set(settings.lineColor);
      backgroundColor = settings.background;
      updateLandColor();
      updateWaterColor();
      updateStageVisibility();
      landscapeRadius =
        (Math.hypot(modelSettings.widthMm, modelSettings.lengthMm) * previewScale) / 2;
      stage.update(
        modelSettings.widthMm * previewScale,
        (modelSettings.cropShape === 'circle' ? modelSettings.widthMm : modelSettings.lengthMm) *
          previewScale,
        customGroundColor ?? settings.background,
        modelSettings.cropShape === 'circle',
      );
      draw();
    },
    setVisible(value: boolean) {
      visible = value;

      if (!value) {
        stopCameraShots?.();
        finishTransition();
        cancelFocusPick?.();
        // Leaving 3D must release the walk's frame loop, key capture and studio state.
        walk.stop();
      }

      renderer.domElement.hidden = !value;
      controls.enabled = value;
      previousTime = performance.now();
      updateLoop();
      draw();
    },
    setHeight(value: number, shouldRebuild = true) {
      // Spike: relief rising or sinking rumbles for as long as it keeps changing.
      if (visible && value !== exaggeration) {
        transitionAudio.sustain();
      }

      exaggeration = value;

      if (shouldRebuild) {
        rebuild();
      }
    },
    setModelSettings(value: TerrainModelSettings) {
      modelSettings = { ...value };
    },
    setFrame(parts, seatHeightMm, finish) {
      const previewScale = getPreviewScale();

      framePreview.update(parts, previewScale, finish);
      landscape.position.y = seatHeightMm * previewScale;
      draw();
    },
    getStl() {
      if (!model) {
        throw new Error('Enable the 3D view before downloading STL.');
      }

      return createBinaryStl(model.solid);
    },
    setContours(value: boolean) {
      showContours = value;
      syncContourTreatment();
      draw();
    },
    setRoadStyle(value: Readonly<RoadStyle>) {
      const wasVisible = roads.mesh.visible || grass.mesh.visible;

      roadStyle = value;
      roads.setStyle(value);
      // Grass keeps clear of drawn roads, so road edits can regrow it.
      updateGrass();

      // Hidden roads change nothing on screen; skipping the frame keeps terrain loads quick.
      if (wasVisible || roads.mesh.visible || grass.mesh.visible) {
        draw();
      }
    },
    setGrassStyle(value: Readonly<GrassStyle>) {
      const wasVisible = grass.mesh.visible;

      grass.setStyle(value);
      updateLoop();

      if (wasVisible || grass.mesh.visible) {
        draw();
      }
    },
    setContourEngraving(value: ContourEngravingSettings) {
      contourTreatment = value.treatment;
      engraving.setSize(value.widthMm, value.depthMm);
      syncContourTreatment();
      draw();
    },
    setElevationGradient(value: ElevationGradientSettings) {
      targetGradient = value;

      if (!isTransitionArmed && !transition) {
        showGradient(value);
      }

      draw();
    },
    setLandFinish(value: LandFinish) {
      landFinish = value;
      updateLandColor();
      surface.material = value === 'natural' ? naturalSurfaceMaterial : surfaceMaterial;
      surfaceMaterial.roughness = landFinishes[value].roughness;
      surfaceMaterial.clearcoat = landFinishes[value].clearcoat;
      draw();
    },
    setWaterFinish(value: WaterFinish) {
      waterFinish = value;
      litWaterMaterial.transparent = value === 'translucent';
      litWaterMaterial.opacity = value === 'translucent' ? waterOpacity : 1;
      litWaterMaterial.depthWrite = value !== 'translucent';
      litWaterMaterial.needsUpdate = true;
      litWaterMaterial.roughness = waterFinishes[value].roughness;
      litWaterMaterial.clearcoat = waterFinishes[value].clearcoat;
      syncWater();

      if (waterStyle === 'solid') {
        sea.material = activeWaterMaterial();
      }

      draw();
    },
    setSurface(value: boolean) {
      surface.visible = value;
      syncContourTreatment();
      base.visible = value && solidBase;
      updateStageVisibility();
      draw();
    },
    setWaterStyle(value: WaterStyle) {
      waterStyle = value;
      sea.material = value === 'solid' ? activeWaterMaterial() : seaMaterial;
      syncWater();
      draw();
    },
    setWaterOpacity(value: number) {
      waterOpacity = Math.max(0, Math.min(1, value));

      if (waterFinish === 'translucent') {
        litWaterMaterial.opacity = waterOpacity;
      }

      draw();
    },
    setPreviewWaterLevel(value: number | undefined) {
      previewWaterLevel = value;
      rebuild();
    },
    setWaterColor(value: string | undefined) {
      customWaterColor = value;
      updateWaterColor();
      draw();
    },
    setBase(value: boolean) {
      solidBase = value;
      base.visible = value && surface.visible;
      updateStageVisibility();
      draw();
    },
    setGround(value: boolean) {
      showGround = value;
      updateStageVisibility();
      draw();
    },
    setGroundColor(value: string | undefined) {
      customGroundColor = value;
      stage.setColor(value ?? backgroundColor);
      updateStageVisibility();
      draw();
    },
    setMapGrid(
      value: boolean,
      place: FloorPlace | undefined,
      contourIntervalMeters: number | undefined,
      floorStyle: FloorStyle,
    ) {
      pendingMapGrid = [value, place, contourIntervalMeters, floorStyle];

      if (!isTransitionArmed && !transition) {
        applyPendingMapGrid();
        draw();
      }
    },
    setSurfaceColor(value: string | undefined) {
      customSurfaceColor = value;
      updateLandColor();
      updateWaterColor();
      draw();
    },
    setLighting(value: Readonly<TerrainLightingSettings>) {
      lighting = value;
      applyLighting();
      draw();
    },
    setCamera: setCameraSettings,
    captureStill(scale: number) {
      if (!visible) {
        throw new Error('Select the 3D view before downloading a 3D still.');
      }

      // Static exports use settled terrain and framing, never a frame mid-animation.
      finishTransition();
      settleViewAnimation?.();
      const pixelRatio = getStillPixelRatio(
        scale,
        viewportWidth,
        viewportHeight,
        renderer.capabilities.maxTextureSize,
      );
      const previousPixelRatio = renderer.getPixelRatio();
      const frame = document.createElement('canvas');
      const context = frame.getContext('2d');

      const resizeTo = (ratio: number) => {
        renderer.setPixelRatio(ratio);
        renderer.setSize(viewportWidth, viewportHeight);
        postProcessing?.setSize(viewportWidth, viewportHeight, ratio);
      };

      if (!context) {
        throw new Error('The browser could not allocate the 3D still. Try a smaller scale.');
      }

      try {
        // Inside the try, so a failed still never leaves the preview's wind switched off.
        grass.setSettled(true);
        resizeTo(pixelRatio);
        render();
        frame.width = renderer.domElement.width;
        frame.height = renderer.domElement.height;
        // Copied in the same task as the render, so no preserved drawing buffer is needed.
        context.drawImage(renderer.domElement, 0, 0);
      } finally {
        resizeTo(previousPixelRatio);
        grass.setSettled(!grass.isAnimated());
        draw();
      }

      // The scene background is opaque, so an empty or transparent copy means allocation failed.
      if (
        frame.width === 0 ||
        frame.height === 0 ||
        context.getImageData(frame.width / 2, frame.height / 2, 1, 1).data[3] === 0
      ) {
        throw new Error('The browser could not allocate the 3D still. Try a smaller scale.');
      }

      return frame;
    },
    getCameraPose() {
      const orbit = new THREE.Spherical().setFromVector3(
        camera.position.clone().sub(controls.target),
      );

      // North is -z, so a camera at azimuth theta looks along bearing -theta.
      return {
        azimuthDegrees: THREE.MathUtils.euclideanModulo(
          -THREE.MathUtils.radToDeg(orbit.theta),
          360,
        ),
        elevationDegrees: 90 - THREE.MathUtils.radToDeg(orbit.phi),
        fovDegrees: perspectiveCamera.fov,
      };
    },
    getSurfaceFractionAt(clientX, clientY) {
      const point = getTerrainPointAt(clientX, clientY);

      // Rebuilds replace the geometry, and morphs keep its footprint, so one box per geometry holds.
      if (!surface.geometry.boundingBox) {
        surface.geometry.computeBoundingBox();
      }

      const bounds = surface.geometry.boundingBox;

      if (!point || !bounds || bounds.isEmpty()) {
        return undefined;
      }

      const local = surface.worldToLocal(point.clone());

      return {
        x: THREE.MathUtils.clamp((local.x - bounds.min.x) / (bounds.max.x - bounds.min.x), 0, 1),
        y: THREE.MathUtils.clamp((local.z - bounds.min.z) / (bounds.max.z - bounds.min.z), 0, 1),
      };
    },
    setRouteMarker(point) {
      route.setInspectedPoint(point);
      syncRouteHooks();
      draw();
    },
    projectCropPointToClient(point) {
      const [, width, height] = lastUpdate ?? [];
      const surfaceHeight = displayedSurface?.heightAt(point);

      if (width === undefined || height === undefined || surfaceHeight === undefined) {
        return undefined;
      }

      const scale = 2 / Math.max(width, height);
      const world = landscape.localToWorld(
        new THREE.Vector3(
          (point.x - width / 2) * scale,
          surfaceHeight,
          (point.y - height / 2) * scale,
        ),
      );

      camera.updateMatrixWorld();
      const ndc = world.project(camera);
      const bounds = renderer.domElement.getBoundingClientRect();

      if (ndc.z < -1 || ndc.z > 1) {
        return undefined;
      }

      return {
        clientX: bounds.left + ((ndc.x + 1) / 2) * bounds.width,
        clientY: bounds.top + ((1 - ndc.y) / 2) * bounds.height,
      };
    },
    walkAt(metersPerUnit, clientX, clientY) {
      const point =
        clientX === undefined || clientY === undefined
          ? controls.target
          : getTerrainPointAt(clientX, clientY);

      return point !== undefined && startWalk(point, metersPerUnit);
    },
    subscribeDraw(listener) {
      drawListeners.add(listener);

      return () => {
        drawListeners.delete(listener);
      };
    },
    pickFocus() {
      const canvas = renderer.domElement;

      cancelFocusPick?.();
      canvas.style.cursor = 'crosshair';

      return new Promise<boolean>((resolve) => {
        let downAt: { x: number; y: number } | undefined;

        const finish = (picked: boolean) => {
          cancelFocusPick = undefined;
          canvas.style.cursor = '';
          canvas.removeEventListener('pointerdown', onDown);
          canvas.removeEventListener('pointerup', onUp);
          document.removeEventListener('keydown', onKey, true);
          resolve(picked);
        };

        const onDown = (event: PointerEvent) => {
          downAt = { x: event.clientX, y: event.clientY };
        };

        // A drag is still an orbit; only a near-stationary click picks focus.
        const onUp = (event: PointerEvent) => {
          if (!downAt || Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > 4) {
            return;
          }

          const point = getTerrainPointAt(event.clientX, event.clientY);

          if (point) {
            pickedFocusPoint = point;
            draw();
          }

          finish(point !== undefined);
        };

        const onKey = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            // Consumed so the studio's Escape handling doesn't also collapse the inspector or close a popover.
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        };

        cancelFocusPick = () => {
          finish(false);
        };

        canvas.addEventListener('pointerdown', onDown);
        canvas.addEventListener('pointerup', onUp);
        // Capture phase runs ahead of the studio's bubbling Escape listener.
        document.addEventListener('keydown', onKey, true);
      });
    },
    setRotationSpeed(value: number) {
      controls.autoRotateSpeed = value;
    },
    applyViewPreset(preset: TerrainViewPreset) {
      stopCameraShots?.();
      const { polarDegrees, azimuthDegrees } = terrainViewPresets[preset];

      animateCameraDirection(
        new THREE.Vector3().setFromSphericalCoords(
          1,
          THREE.MathUtils.degToRad(polarDegrees),
          THREE.MathUtils.degToRad(azimuthDegrees),
        ),
      );
    },
    setCameraDirection(azimuthDegrees: number, elevationDegrees: number) {
      stopCameraShots?.();
      animateCameraDirection(
        new THREE.Vector3().setFromSphericalCoords(
          1,
          THREE.MathUtils.degToRad(90 - elevationDegrees),
          THREE.MathUtils.degToRad(azimuthDegrees),
        ),
      );
    },
    requestTransition() {
      stopCameraShots?.();
      isTransitionArmed = true;
    },
    setRotating(value: boolean) {
      rotating = value;
      // A running tour restores the turntable when it stops.
      controls.autoRotate = value && stopCameraShots === undefined;
      previousTime = performance.now();
      updateLoop();
    },
    reset,
    captureCameraShot() {
      if (walk.isWalking) {
        return undefined;
      }

      const thumbnail = document.createElement('canvas');
      const source = renderer.domElement;

      thumbnail.width = 192;
      thumbnail.height = Math.max(1, Math.round((192 * source.height) / source.width));
      // Drawn straight after a render, before the WebGL buffer is cleared.
      render();
      thumbnail.getContext('2d')?.drawImage(source, 0, 0, thumbnail.width, thumbnail.height);

      return { shot: getCameraShot(), thumbnailUrl: thumbnail.toDataURL('image/jpeg', 0.8) };
    },
    flyToCameraShot(shot: CameraShot) {
      if (walk.isWalking) {
        return false;
      }

      runCameraShots([shot], false);

      return true;
    },
    playCameraShots(shots: readonly CameraShot[], onStop: () => void) {
      if (walk.isWalking) {
        return false;
      }

      runCameraShots(shots, true, onStop);

      return true;
    },
    stopCameraShots() {
      stopCameraShots?.();
    },
  };

  return api;
}
