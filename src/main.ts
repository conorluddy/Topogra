import { cropTerrainModelField } from './terrain-model';
import type { HeightField } from './types/terrain';
import { createSeaLevelGeometry, type SeaLevelGeometry } from './sea-level';
import { createStudioTerrainView } from './studio/terrain-view';
import { createStudioController, getSceneCredits } from './studio/controller';
import { createCompareSceneStore } from './studio/compare-scene';
import { createCropPreview } from './studio/crop-preview';
import { mountStudio, phoneViewportQuery } from './studio/app';
import { modeFlipTiming } from './studio/mode-flip';
import { createCanvasSuspender } from './studio/canvas-suspend';
import { readSystemLink, replaceSystemLink } from './system-link';
import { applySignalAccent, readSignalAccent } from './studio/accent';
import { browserLocalStorage, browserSessionStorage } from './studio/browser-storage';
import { readStoredScene, saveStoredScene } from './studio/scene-storage';
import { shouldShowSplash } from './studio/pages/splash-session';
import { signalAccentStorageKey } from './constants/library';
import { downloadBlob } from './studio/export-panel';
import { encodeTerrainStill } from './export/still-export';
import { createBinaryStl } from './export/stl-export';
import type { RealTerrain } from './real-terrain';
import { createFloorPlace } from './floor-geo';
import { clipRoadsToCrop, noRoadPaths } from './road-ribbons';
import {
  clipRouteToCrop,
  noRouteOverlay,
  projectRoutePointToCrop,
  type TerrainRouteOverlay,
} from './terrain-3d-route';
import { locateRouteDistance } from './route-sampling';
import type { RoadPath } from './types/roads';
import type { GrassGeography } from './grass-coverage';
import { generatedTerrainReliefMeters, generatedTerrainSpanMeters } from './constants/grass';
import { findTerrainSummits } from './summit-markers';
import { getRequiredElement } from './dom-elements';
import { awayPointer, createHudStore, type MapLocation } from './studio/hud-store';
import { projectToRealTerrainFrame } from './real-terrain-projection';
import {
  getFrameMetersPerPixel,
  locateModelFraction,
  locateViewportPoint,
  type ModelPlacement,
} from './studio/hud-location';
import { applyTheme, currentTheme, readTheme, subscribeToTheme } from './studio/theme';
import './ui/ui.css';
import './studio/studio.css';
import './studio/studio-surfaces.css';
import './studio/analytics-consent-dialog.css';
import './studio/studio-phone.css';
import { designChangePriority, versionOneDesignDefaults } from './constants/design';
import { engineConfiguration } from './constants/engine';
import { operationErrorCodes } from './constants/operations';
import { designUrlDebounceMs } from './constants/sharing';
import {
  extractLandscapeContours as extractContours,
  getRealContourInterval,
} from './real-terrain-contours';
import { applyCursorElevation } from './cursor-interaction';
import {
  classifyDesignSettingChange,
  deriveTerrainConfiguration,
  parseDesignParameters,
  validateDesignSettings,
} from './design-settings';
import {
  copyDesignLink,
  hasDesignParameters,
  loadInitialDesign,
  readDesignStyle,
  readLockedSeed,
  replaceDesignUrl,
  saveDesignStyle,
  saveLockedSeed,
} from './design-sharing';
import { createOutputRenderer } from './export/image-export';
import { calculateContourElevations, getTerrainTerraceLevels } from './landscape-composition';
import { startAnalyticsIfAllowed } from './analytics-consent';
import { logOperationError } from './operation-logging';
import { renderContoursIntoSvg } from './svg-rendering';
import { createTerrainSampler, sampleTerrain } from './terrain-generation';
import type { CursorInfluence } from './types/cursor';
import type { DesignChangeKind, DesignSettings } from './types/design';
import type { OperationError, Result } from './types/operations';

const millisecondsPerSecond = 1000;
const maximumCursorFrameElapsedMs = 100;
const cursorPositionSettlingTolerancePixels = 0.5;
const cursorStrengthSettlingTolerance = 0.002;

/** Restores startup settings before sampling the first landscape. */
const startupStartedAtMs = performance.now();
/** Uses browser randomness for a fresh unsigned landscape seed. */
const generateRandomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
let storedSeedResult: Result<number | null>;

try {
  storedSeedResult = readLockedSeed(localStorage);
} catch {
  storedSeedResult = {
    ok: false,
    error: {
      code: operationErrorCodes.storageFailed,
      message: 'Browser storage is unavailable. Use Copy link to save this design.',
      retryable: true,
    },
  };
}

startAnalyticsIfAllowed(location.hostname, browserLocalStorage);

const opensDesignLink = hasDesignParameters(new URLSearchParams(location.search));
const storedStyleResult = readDesignStyle(browserLocalStorage);

if (!storedStyleResult.ok) {
  logOperationError(storedStyleResult.error);
}

const initialDesignResult = loadInitialDesign(
  new URLSearchParams(location.search),
  { width: innerWidth, height: innerHeight },
  generateRandomSeed(),
  storedSeedResult.ok ? storedSeedResult.data : null,
  storedStyleResult.ok ? storedStyleResult.data : undefined,
);
const fallbackDesignResult = parseDesignParameters(new URLSearchParams(), versionOneDesignDefaults);

if (!fallbackDesignResult.ok) {
  throw new Error('Invalid built-in settings');
}

let settings = initialDesignResult.ok
  ? initialDesignResult.data.settings
  : fallbackDesignResult.data.settings;
let terrainSettings = deriveTerrainConfiguration(settings, engineConfiguration);
let realTerrain: RealTerrain | undefined;
let terrain = createTerrainSampler(settings.seed, terrainSettings);
const terrainSvgElement = getRequiredElement(document, '#terrain', SVGSVGElement);
const reducedMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const cursor: CursorInfluence = { x: 0, y: 0, strength: 0 };
const targetCursorInfluence: CursorInfluence = { ...cursor };
let width = innerWidth;
let height = innerHeight;
let baseHeightField = sampleTerrain(terrain, width, height, terrainSettings);
let contourElevations = calculateContourElevations(settings, engineConfiguration, realTerrain);
let summits: ReturnType<typeof findTerrainSummits> = [];
let contours: ReturnType<typeof extractContours> = [];
let seaLevel: SeaLevelGeometry | undefined;
let cursorAnimationFrameIdentifier: number | undefined;
let lastCursorFrameTimeMs = 0;
let lastContourRenderTimeMs = 0;
let designUrlDebounceTimer: ReturnType<typeof setTimeout> | undefined;
let pendingChange: DesignChangeKind | undefined;
let settingsUpdateFrameIdentifier: number | undefined;
const reportedStorageFailures = new Set<string>();
const hud = createHudStore();
const compareScenes = createCompareSceneStore();
let pendingHudPointerEvent: PointerEvent | undefined;
let hudPointerFrameIdentifier: number | undefined;
let reliefField: HeightField | undefined;
let modelPlacement: ModelPlacement | undefined;

const controls = createStudioController(
  {
    getSettings: () => settings,
    updateSettings,
    newLandscape: () => {
      if (!realTerrain) {
        requestTerrainTransition();
      }

      updateSettings({ ...settings, seed: generateRandomSeed() });
    },
    isSeedLocked: storedSeedResult.ok && storedSeedResult.data === settings.seed,
    lockSeed: (isLocked) => {
      try {
        const result = saveLockedSeed(localStorage, isLocked ? settings.seed : null);

        if (!result.ok) {
          logOperationError(result.error);
          controls.notify(result.error.message);
        }
      } catch {
        controls.notify('Browser storage is unavailable. Use Copy link to save this design.');
        logOperationError({
          code: operationErrorCodes.storageFailed,
          message: 'Browser storage access failed',
          retryable: true,
        });
      }
    },
    getShareUrl: synchronizeDesignUrl,
    copyLink: (url) => copyDesignLink(url, navigator.clipboard),
  },
  undefined,
  // Reads `localStorage` per call: touching it can throw when storage is blocked.
  {
    getItem: (key) => localStorage.getItem(key),
    setItem: (key, value) => {
      localStorage.setItem(key, value);
    },
  },
);
const outputRenderer = createOutputRenderer(engineConfiguration, () => realTerrain);
const cropPreview = createCropPreview(controls);
const terrain3d = createStudioTerrainView(controls, () => {
  cursor.strength = targetCursorInfluence.strength = 0;
  renderCurrentLandscape();
});

controls.connect({
  activate: terrain3d.activate,
  sceneChanged: terrain3d.sceneChanged,
  modelChanged: terrain3d.modelChanged,
  resetCamera: terrain3d.resetCamera,
  applyViewPreset: terrain3d.applyViewPreset,
  setCameraDirection: terrain3d.setCameraDirection,
  walkAt: terrain3d.walkAt,
  pickFocus: terrain3d.pickFocus,
  captureCameraShot: terrain3d.captureCameraShot,
  flyToCameraShot: terrain3d.flyToCameraShot,
  playCameraShots: terrain3d.playCameraShots,
  stopCameraShots: terrain3d.stopCameraShots,
  async downloadStill(scale) {
    const frame = terrain3d.captureStill(scale);

    downloadBlob(
      await encodeTerrainStill(frame, getStillAttribution()),
      `landcube-${settings.seed}-3d-${scale}x.png`,
    );

    return { width: frame.width, height: frame.height };
  },
  frameChanged: terrain3d.frameChanged,
  downloadFrameStl: (part) => {
    downloadBlob(
      new Blob([createBinaryStl(part.solid, `landcube ${part.id}`)], { type: 'model/stl' }),
      // Size in the name keeps parts for different frames apart in one downloads folder.
      `landcube-${settings.seed}-${part.id}-${Math.round(part.sizeMm.x)}x${Math.round(part.sizeMm.z)}mm.stl`,
    );
  },
  downloadStl: () => {
    const model = controls.getSnapshot().model.dimensions;

    downloadBlob(
      new Blob([terrain3d.getStl()], { type: 'model/stl' }),
      model.cropShape === 'circle'
        ? `landcube-${settings.seed}-circle-${model.widthMm}mm.stl`
        : `landcube-${settings.seed}-${model.widthMm}x${model.lengthMm}mm.stl`,
    );
  },
  roadsChanged: updateTerrain3d,
  applyTerrain: (loadedTerrain, shouldTransition) => {
    if (shouldTransition) {
      requestTerrainTransition();
    }

    realTerrain = loadedTerrain;
    contourElevations = calculateContourElevations(settings, engineConfiguration, realTerrain);
    terrain = realTerrain
      ? (x, y) => sampleLoadedTerrain(x, y)
      : createTerrainSampler(settings.seed, terrainSettings);
    cursor.strength = targetCursorInfluence.strength = 0;
    baseHeightField = sampleTerrain(terrain, width, height, terrainSettings);
    renderCurrentLandscape();
  },
});

if (!storedSeedResult.ok) {
  logOperationError(storedSeedResult.error);
  controls.notify(storedSeedResult.error.message);
}

if (!initialDesignResult.ok) {
  logOperationError(initialDesignResult.error);
  controls.notify(initialDesignResult.error.message);
} else if (initialDesignResult.data.warnings.length) {
  const message = `Unsupported values for ${initialDesignResult.data.warnings.join(', ')} were reset to defaults.`;

  logOperationError({ code: operationErrorCodes.invalidSettings, message, retryable: true });
  controls.notify(message);
}

const storedSceneResult = readStoredScene(browserLocalStorage, controls.getSnapshot().scene);

if (storedSceneResult.ok) {
  controls.scene(storedSceneResult.data);
} else {
  logOperationError(storedSceneResult.error);
}

let savedScene = controls.getSnapshot().scene;

controls.subscribe(() => {
  const { scene } = controls.getSnapshot();

  // The daylight sweep moves the sun 20 times a second; the look saves once it stops.
  if (scene === savedScene || scene.daylightCycle.enabled) {
    return;
  }

  savedScene = scene;
  const result = saveStoredScene(browserLocalStorage, scene);

  if (!result.ok) {
    reportStorageFailureOnce(result.error);
  }
});

/** Commits a validated edit and batches the required rendering work. */
function updateSettings(nextDesignSettings: DesignSettings): boolean {
  const result = validateDesignSettings(nextDesignSettings);

  if (!result.ok) {
    logOperationError(result.error);
    controls.notify(result.error.message);

    return false;
  }

  const changed = (Object.keys(nextDesignSettings) as (keyof DesignSettings)[]).filter(
    (key) => nextDesignSettings[key] !== settings[key],
  );

  settings = result.data;
  let hasStyleChange = false;

  for (const key of changed) {
    const kind = classifyDesignSettingChange(key);

    hasStyleChange ||= kind !== 'terrain' && kind !== 'output';

    if (!pendingChange || designChangePriority[kind] > designChangePriority[pendingChange]) {
      pendingChange = kind;
    }
  }

  clearTimeout(designUrlDebounceTimer);
  designUrlDebounceTimer = setTimeout(synchronizeDesignUrl, designUrlDebounceMs);

  if (hasStyleChange) {
    const saved = saveDesignStyle(browserLocalStorage, settings);

    if (!saved.ok) {
      reportStorageFailureOnce(saved.error);
    }
  }

  if (settingsUpdateFrameIdentifier !== undefined || !pendingChange) {
    return true;
  }

  settingsUpdateFrameIdentifier = requestAnimationFrame(() => {
    /** Batches edits so each frame performs only the most expensive required refresh. */
    settingsUpdateFrameIdentifier = undefined;
    const change = pendingChange;

    pendingChange = undefined;
    applyPageStyle();

    if (!settings.cursorEnabled) {
      cursor.strength = targetCursorInfluence.strength = 0;
    }

    if (change === 'terrain') {
      terrainSettings = deriveTerrainConfiguration(settings, engineConfiguration);
      terrain = realTerrain
        ? (x, y) => sampleLoadedTerrain(x, y)
        : createTerrainSampler(settings.seed, terrainSettings);
      baseHeightField = sampleTerrain(terrain, width, height, terrainSettings);
    }

    if (change === 'terrain' || change === 'contours') {
      contourElevations = calculateContourElevations(settings, engineConfiguration, realTerrain);
    }

    if (change === 'appearance') {
      updateTerrain3d();
      renderContoursIntoSvg(
        terrainSvgElement,
        contours,
        width,
        height,
        settings,
        summits,
        seaLevel,
      );
    } else if (change !== 'output') {
      renderCurrentLandscape();
    }

    controls.sync();
  });

  return true;
}

/** Arms a 3D landscape morph for the next rebuild; reduced motion always cuts. */
function requestTerrainTransition(): void {
  if (!reducedMotionPreference.matches) {
    terrain3d.requestTransition();
  }
}

/** Flushes pending edits into the current share URL. */
function synchronizeDesignUrl(): string {
  clearTimeout(designUrlDebounceTimer);

  return replaceDesignUrl(location.href, settings, history);
}

/** Style saves repeat on every edit, so blocked storage is logged once per message, not per slider step. */
function reportStorageFailureOnce(error: OperationError): void {
  if (reportedStorageFailures.has(error.message)) {
    return;
  }

  reportedStorageFailures.add(error.message);
  logOperationError(error);
}

/** Keeps the page backdrop and browser theme aligned with the design. */
function applyPageStyle(): void {
  document.documentElement.style.backgroundColor = settings.background;
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', readBrowserChromeColor(settings.background));
}

/** The canvas fills the viewport, so the design background tints the browser; the light theme tints it light. */
function readBrowserChromeColor(designBackground: string): string {
  if (currentTheme(document.documentElement) !== 'light') {
    return designBackground;
  }

  return getComputedStyle(document.documentElement).getPropertyValue('--lc-theme-color').trim();
}

/** Renders the current cursor influence over cached base terrain. */
function renderCurrentLandscape(): void {
  const field =
    realTerrain || terrain3d.isActive()
      ? baseHeightField
      : applyCursorElevation(baseHeightField, cursor, settings);

  publishGeneratedRelief();
  contours = extractContours(field, contourElevations, realTerrain);
  summits = findTerrainSummits(field);
  seaLevel = createSeaLevelGeometry(field, width, height, realTerrain);
  updateTerrain3d();
  renderContoursIntoSvg(terrainSvgElement, contours, width, height, settings, summits, seaLevel);
  compareScenes.publish({ contours, width, height, summits, seaLevel });
}

// The source frame is captured once; viewport resizes never change printable terrain.
let modelSourceFrame: { width: number; height: number } | undefined;
let modelSourceSampler: typeof terrain | undefined;
let modelSourceField: HeightField | undefined;
let modelCropKey = '';
let modelCrop: ReturnType<typeof cropTerrainModelField> | undefined;
let roadPaths: { key: unknown[]; paths: RoadPath[] } = { key: [], paths: [] };
let routeOverlay: { key: unknown[]; overlay: TerrainRouteOverlay } = {
  key: [],
  overlay: noRouteOverlay,
};

function updateTerrain3d(): void {
  if (!terrain3d.isActive()) {
    return;
  }

  modelSourceFrame ??= { width, height };

  if (modelSourceSampler !== terrain || !modelSourceField) {
    const frame = modelSourceFrame;
    const loaded = realTerrain;
    const sampler = loaded
      ? (x: number, y: number) => loaded.sample(x, y, frame.width, frame.height)
      : terrain;

    modelSourceField = sampleTerrain(sampler, frame.width, frame.height, terrainSettings);
    modelSourceSampler = terrain;
    modelCrop = undefined;
  }

  cropPreview.update(
    modelSourceField,
    modelSourceFrame.width,
    modelSourceFrame.height,
    settings,
    realTerrain ? contourElevations : undefined,
  );
  const dimensions = controls.getSnapshot().model.dimensions;
  const crop = controls.getSnapshot().model.crop;
  const key = JSON.stringify([dimensions.widthMm, dimensions.lengthMm, dimensions.cropShape, crop]);

  if (!modelCrop || key !== modelCropKey) {
    modelCrop = cropTerrainModelField(
      modelSourceField,
      modelSourceFrame.width,
      modelSourceFrame.height,
      dimensions,
      crop,
    );
    modelCropKey = key;
  }

  const croppedContours = extractContours(modelCrop.field, contourElevations, realTerrain);
  const croppedSea = createSeaLevelGeometry(
    modelCrop.field,
    modelCrop.width,
    modelCrop.height,
    realTerrain,
  );

  const place = createFloorPlace(
    realTerrain,
    modelCrop,
    modelSourceFrame,
    controls.getSnapshot().savedPlaces,
  );

  modelPlacement =
    place && realTerrain?.location && realTerrain.spanKm !== undefined
      ? {
          kind: 'geographic',
          placement: { location: realTerrain.location, spanKm: realTerrain.spanKm },
          crop: modelCrop,
          frame: modelSourceFrame,
        }
      : realTerrain
        ? undefined
        : { kind: 'generated', crop: modelCrop, frame: modelSourceFrame };
  // Before the update, so the update builds roads at the new auto width. A width change also
  // rebuilds once on the previous terrain; that costs one ribbon pass per place load.
  controls.modelSpan(place ? Math.max(place.widthKm, place.lengthKm) : undefined);
  terrain3d.update(
    croppedContours,
    modelCrop.width,
    modelCrop.height,
    settings,
    modelCrop.field,
    croppedSea,
    realTerrain?.attribution,
    place,
    getRealContourInterval(realTerrain),
    getTerrainTerraceLevels(settings, engineConfiguration, realTerrain),
    getCroppedRoadPaths(modelSourceFrame, modelCrop, dimensions.cropShape ?? 'rectangle'),
    getGrassGeography(modelSourceFrame, modelCrop),
    getCroppedRoute(modelSourceFrame, modelCrop, dimensions.cropShape ?? 'rectangle'),
  );
  syncRouteMarker();
}

/** Real scale and source anchoring for grass; generated terrain gets a nominal scale. */
function getGrassGeography(
  frame: { width: number; height: number },
  crop: NonNullable<typeof modelCrop>,
): GrassGeography {
  const frameSize = Math.max(frame.width, frame.height);
  const elevations = realTerrain?.elevations;
  const spanKm = realTerrain?.spanKm;

  return {
    originX: crop.x,
    originY: crop.y,
    metersPerFieldUnit:
      elevations?.metersPerUnit ??
      generatedTerrainReliefMeters /
        (engineConfiguration.elevationMax - engineConfiguration.elevationMin),
    metersPerFrameUnit:
      spanKm === undefined ? generatedTerrainSpanMeters / frameSize : (spanKm * 1000) / frameSize,
  };
}

/** Projects the current road network into the model crop, reusing the last result when unchanged. */
function getCroppedRoadPaths(
  frame: { width: number; height: number },
  crop: NonNullable<typeof modelCrop>,
  shape: 'rectangle' | 'circle',
): readonly RoadPath[] {
  const { roads } = controls.getSnapshot();
  const location = realTerrain?.location;
  const spanKm = realTerrain?.spanKm;

  // Disabled roads still project, so switching them back on needs no terrain update.
  if (!roads.network || !location || spanKm === undefined) {
    return noRoadPaths;
  }

  const key = [roads.network, location, spanKm, frame, crop, shape];

  if (key.some((value, index) => value !== roadPaths.key[index])) {
    roadPaths = {
      key,
      paths: clipRoadsToCrop(roads.network.roads, { location, spanKm }, frame, crop, shape),
    };
  }

  return roadPaths.paths;
}

/** Projects the visible GPX route into the model crop, reusing the last result when unchanged. */
function getCroppedRoute(
  frame: { width: number; height: number },
  crop: NonNullable<typeof modelCrop>,
  shape: 'rectangle' | 'circle',
): TerrainRouteOverlay {
  const { route } = controls.getSnapshot().workspace;
  const location = realTerrain?.location;
  const spanKm = realTerrain?.spanKm;

  if (route === null || !route.isVisible || !location || spanKm === undefined) {
    return noRouteOverlay;
  }

  // Geometry only: threshold and inspection edits keep the projected route and its ribbon.
  const { waypoints, namedWaypoints } = route.active;
  const key = [waypoints, namedWaypoints, location, spanKm, frame, crop, shape];

  if (key.some((value, index) => value !== routeOverlay.key[index])) {
    routeOverlay = {
      key,
      overlay: clipRouteToCrop(
        { points: route.active.waypoints, waypoints: route.active.namedWaypoints },
        { location, spanKm },
        frame,
        crop,
        shape,
      ),
    };
  }

  return routeOverlay.overlay;
}

/** Points the 3D marker at the profile's inspected distance, on the same basis as the analysis. */
function syncRouteMarker(): void {
  const { route } = controls.getSnapshot().workspace;
  const location = realTerrain?.location;
  const spanKm = realTerrain?.spanKm;

  if (
    !terrain3d.isActive() ||
    route?.inspectedDistanceMeters === undefined ||
    !route.isVisible ||
    !location ||
    spanKm === undefined ||
    !modelSourceFrame ||
    !modelCrop
  ) {
    terrain3d.setRouteMarker(undefined);

    return;
  }

  const point = locateRouteDistance(
    route.active.originalPoints ?? route.active.waypoints,
    route.inspectedDistanceMeters,
  );

  terrain3d.setRouteMarker(
    point &&
      projectRoutePointToCrop(
        point,
        { location, spanKm },
        modelSourceFrame,
        modelCrop,
        controls.getSnapshot().model.dimensions.cropShape ?? 'rectangle',
      ),
  );
}

/** Credits every external source visible in the 3D view. */
function getStillAttribution(): string[] {
  return getSceneCredits(controls.getSnapshot(), realTerrain?.attribution);
}

/** Eases cursor deformation with capped frame pacing until settled. */
function animateCursorInfluence(time: number): void {
  cursorAnimationFrameIdentifier = undefined;

  if (document.hidden) {
    return;
  }

  if (time - lastContourRenderTimeMs < millisecondsPerSecond / engineConfiguration.cursorMaxFps) {
    cursorAnimationFrameIdentifier = requestAnimationFrame(animateCursorInfluence);

    return;
  }

  const elapsedFrameTimeMs = lastCursorFrameTimeMs
    ? Math.min(time - lastCursorFrameTimeMs, maximumCursorFrameElapsedMs)
    : millisecondsPerSecond / engineConfiguration.cursorMaxFps;

  lastCursorFrameTimeMs = time;
  lastContourRenderTimeMs = time;
  const cursorInterpolationWeight = reducedMotionPreference.matches
    ? 1
    : 1 - Math.exp(-elapsedFrameTimeMs / settings.cursorResponseMs);

  cursor.x += (targetCursorInfluence.x - cursor.x) * cursorInterpolationWeight;
  cursor.y += (targetCursorInfluence.y - cursor.y) * cursorInterpolationWeight;
  cursor.strength += (targetCursorInfluence.strength - cursor.strength) * cursorInterpolationWeight;
  const isSettled =
    Math.abs(targetCursorInfluence.x - cursor.x) < cursorPositionSettlingTolerancePixels &&
    Math.abs(targetCursorInfluence.y - cursor.y) < cursorPositionSettlingTolerancePixels &&
    Math.abs(targetCursorInfluence.strength - cursor.strength) < cursorStrengthSettlingTolerance;

  if (isSettled) {
    Object.assign(cursor, targetCursorInfluence);
  }

  renderCurrentLandscape();

  if (!isSettled) {
    cursorAnimationFrameIdentifier = requestAnimationFrame(animateCursorInfluence);
  }
}

/** Starts a single animation loop when the page can render. */
function scheduleCursorAnimation(): void {
  if (cursorAnimationFrameIdentifier !== undefined || document.hidden) {
    return;
  }

  lastCursorFrameTimeMs = 0;
  cursorAnimationFrameIdentifier = requestAnimationFrame(animateCursorInfluence);
}

/** Tracks eligible pointers while keeping control interaction deformation-free. */
function moveCursor(event: PointerEvent): void {
  trackHudPointer(event);

  if (
    terrain3d.isActive() ||
    realTerrain !== undefined ||
    !settings.cursorEnabled ||
    (event.target instanceof Element && event.target.closest('[data-ui-surface]'))
  ) {
    if (targetCursorInfluence.strength !== 0) {
      releaseCursor();
    }

    return;
  }

  if (event.pointerType === 'touch' && event.buttons === 0) {
    return;
  }

  const bounds = terrainSvgElement.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;

  if (cursor.strength === 0) {
    cursor.x = x;
    cursor.y = y;
  }

  Object.assign(targetCursorInfluence, { x, y, strength: 1 });
  scheduleCursorAnimation();
}

/** Lets the cursor hill settle back into the base terrain. */
function releaseCursor(): void {
  Object.assign(targetCursorInfluence, { x: cursor.x, y: cursor.y, strength: 0 });
  scheduleCursorAnimation();
}

/** The pointer left the page or was cancelled: settle the cursor hill and hide the crosshair. */
function releasePointer(): void {
  pendingHudPointerEvent = undefined;
  hud.setPointer(awayPointer);
  releaseCursor();
}

/** Feeds the HUD crosshair: a mouse or pen over the open viewport, never over a UI surface. */
function trackHudPointer(event: PointerEvent): void {
  const isOverViewport =
    event.pointerType !== 'touch' &&
    event.target instanceof Element &&
    event.target.closest('#studio-viewport') !== null &&
    event.target.closest('[data-ui-surface]') === null;

  if (!isOverViewport) {
    pendingHudPointerEvent = undefined;
    hud.setPointer(awayPointer);

    return;
  }

  pendingHudPointerEvent = event;
  hudPointerFrameIdentifier ??= requestAnimationFrame(publishHudPointer);
}

/** Locates the latest pointer once per frame; a 3D drag keeps the last location instead of ray casting. */
function publishHudPointer(): void {
  hudPointerFrameIdentifier = undefined;
  const event = pendingHudPointerEvent;

  if (!event) {
    return;
  }

  const bounds = terrainSvgElement.getBoundingClientRect();
  const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };

  hud.setPointer({
    kind: 'tracking',
    xPx: point.x,
    yPx: point.y,
    location: locatePointer(event, point),
  });
}

function locatePointer(
  event: PointerEvent,
  point: { x: number; y: number },
): MapLocation | undefined {
  if (!terrain3d.isActive()) {
    return locateViewportPoint(point, { width, height }, realTerrain);
  }

  const previous = hud.getSnapshot().pointer;

  if (event.buttons !== 0) {
    return previous.kind === 'tracking' ? previous.location : undefined;
  }

  return locateModelSurfacePoint(event.clientX, event.clientY);
}

/** The place on the 3D model under a viewport point; undefined over sky or before the model. */
function locateModelSurfacePoint(clientX: number, clientY: number): MapLocation | undefined {
  const fraction = terrain3d.getSurfaceFractionAt(clientX, clientY);

  return fraction && modelPlacement ? locateModelFraction(fraction, modelPlacement) : undefined;
}

/** The measure tool locates its endpoints on demand, with the same mapping as the coordinate tip. */
function locateClientPoint(clientX: number, clientY: number): MapLocation | undefined {
  if (terrain3d.isActive()) {
    return locateModelSurfacePoint(clientX, clientY);
  }

  const bounds = terrainSvgElement.getBoundingClientRect();

  return locateViewportPoint(
    { x: clientX - bounds.left, y: clientY - bounds.top },
    { width, height },
    realTerrain,
  );
}

/** A place in the model's crop units; undefined outside the crop or for a mismatched terrain kind. */
function projectLocationToCrop(location: MapLocation): { x: number; y: number } | undefined {
  if (!modelSourceFrame || !modelCrop) {
    return undefined;
  }

  if (location.kind === 'local') {
    if (realTerrain) {
      return undefined;
    }

    const metersPerUnit = getFrameMetersPerPixel(modelSourceFrame, undefined);
    const point = {
      x: location.eastMeters / metersPerUnit - modelCrop.x,
      y: location.southMeters / metersPerUnit - modelCrop.y,
    };

    return point.x >= 0 && point.y >= 0 && point.x <= modelCrop.width && point.y <= modelCrop.height
      ? point
      : undefined;
  }

  if (!realTerrain?.location || realTerrain.spanKm === undefined) {
    return undefined;
  }

  return projectRoutePointToCrop(
    location,
    { location: realTerrain.location, spanKm: realTerrain.spanKm },
    modelSourceFrame,
    modelCrop,
    controls.getSnapshot().model.dimensions.cropShape ?? 'rectangle',
  );
}

/**
 * Where a place appears over the viewport, in the same pixels as the HUD pointer. 2D uses the
 * frame projection; 3D projects through the camera onto the displayed surface.
 */
function projectLocation(location: MapLocation): { xPx: number; yPx: number } | undefined {
  const bounds = terrainSvgElement.getBoundingClientRect();

  if (terrain3d.isActive()) {
    const cropPoint = projectLocationToCrop(location);
    const client = cropPoint && terrain3d.projectCropPointToClient(cropPoint);

    return client && { xPx: client.clientX - bounds.left, yPx: client.clientY - bounds.top };
  }

  if (location.kind === 'geographic') {
    if (!realTerrain?.location || realTerrain.spanKm === undefined) {
      return undefined;
    }

    const { x, y } = projectToRealTerrainFrame(
      { location: realTerrain.location, spanKm: realTerrain.spanKm },
      location.latitude,
      location.longitude,
      { width, height },
    );

    return { xPx: x, yPx: y };
  }

  const metersPerPixel = getFrameMetersPerPixel({ width, height }, undefined);

  return { xPx: location.eastMeters / metersPerPixel, yPx: location.southMeters / metersPerPixel };
}

/** Generated terrain's elevation range on its nominal relief, recomputed when the field changes. */
function publishGeneratedRelief(): void {
  if (realTerrain) {
    reliefField = undefined;
    hud.setGeneratedRelief(undefined);

    return;
  }

  if (reliefField === baseHeightField) {
    return;
  }

  reliefField = baseHeightField;
  let minimum = Infinity;
  let maximum = -Infinity;

  for (const value of baseHeightField.values) {
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }

  const metersPerUnit =
    generatedTerrainReliefMeters /
    (engineConfiguration.elevationMax - engineConfiguration.elevationMin);

  hud.setGeneratedRelief({
    minimum: Math.round((minimum - engineConfiguration.elevationMin) * metersPerUnit),
    maximum: Math.round((maximum - engineConfiguration.elevationMin) * metersPerUnit),
  });
}

/** Connects pointer and page lifecycle events to rendering and URL synchronization. */
window.addEventListener('pointermove', moveCursor, { passive: true });
window.addEventListener('pointerdown', moveCursor, { passive: true });
window.addEventListener('pointerup', (event) => {
  if (event.pointerType === 'touch') {
    releasePointer();
  }
});
window.addEventListener('pointercancel', releasePointer);
document.documentElement.addEventListener('pointerleave', releasePointer);
window.addEventListener('blur', releasePointer);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (cursorAnimationFrameIdentifier !== undefined) {
      cancelAnimationFrame(cursorAnimationFrameIdentifier);
    }

    cursorAnimationFrameIdentifier = undefined;
    cursor.strength = targetCursorInfluence.strength = 0;
    synchronizeDesignUrl();
  } else {
    scheduleCursorAnimation();
  }
});
window.addEventListener('pagehide', synchronizeDesignUrl);
window.addEventListener('popstate', () => {
  /** Restores design state when browser navigation changes the shared URL. */
  const result = parseDesignParameters(new URLSearchParams(location.search));

  if (!result.ok) {
    controls.notify(result.error.message);
    logOperationError(result.error);

    return;
  }

  updateSettings(result.data.settings);
  controls.sync();
});
let viewportResizeDebounceTimer: ReturnType<typeof setTimeout>;

// Stored appearance applies before the first paint of the studio; the splash is phone-only.
applyTheme(readTheme(browserLocalStorage), document.documentElement, browserLocalStorage);
applySignalAccent(
  readSignalAccent(browserLocalStorage, signalAccentStorageKey),
  document.documentElement,
  browserLocalStorage,
  signalAccentStorageKey,
);
// Route geometry and visibility redraw the 3D model; the profile cursor only moves its marker.
// 2D reads the route straight from state. Terrain, crop and model changes update 3D themselves.
let drawnRoute = controls.getSnapshot().workspace.route;
// Design-system mode fades the canvas out, then stops 3D drawing; returning resumes before the fade in.
const canvasSuspender = createCanvasSuspender({
  initialMode: controls.getSnapshot().workspace.mode,
  fadeMs: modeFlipTiming.canvasFadeMs,
  timers: {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => {
      window.clearTimeout(handle);
    },
  },
  setSuspended: (isSuspended) => {
    terrain3d.setSuspended(isSuspended);
  },
});

controls.subscribe(() => {
  const { route, mode } = controls.getSnapshot().workspace;
  const previous = drawnRoute;

  drawnRoute = route;

  if (
    route?.active.waypoints !== previous?.active.waypoints ||
    route?.active.namedWaypoints !== previous?.active.namedWaypoints ||
    route?.isVisible !== previous?.isVisible
  ) {
    updateTerrain3d();
  } else if (
    route?.inspectedDistanceMeters !== previous?.inspectedDistanceMeters ||
    route?.active.originalPoints !== previous?.active.originalPoints
  ) {
    syncRouteMarker();
  }

  canvasSuspender.follow(mode);
});
// A `?mode=system` link opens the design-system gallery (desktop only); the address bar then
// follows the part on show, so any part can be linked to.
const openedSystemLink = readSystemLink(new URLSearchParams(location.search));

if (openedSystemLink !== undefined && matchMedia(phoneViewportQuery).matches) {
  replaceSystemLink(location.href, undefined, history);
} else if (openedSystemLink !== undefined) {
  controls.workspace({
    mode: 'system',
    systemPartId: openedSystemLink.partReference ?? controls.getSnapshot().workspace.systemPartId,
  });
}

// What the address bar names now, so the subscriber below writes only real changes.
let linkedSystemPartId = readSystemLink(new URLSearchParams(location.search))?.partReference;

controls.subscribe(() => {
  const { mode, systemPartId } = controls.getSnapshot().workspace;
  const partId = mode === 'system' ? systemPartId : undefined;

  if (partId !== linkedSystemPartId) {
    linkedSystemPartId = partId;
    replaceSystemLink(location.href, partId, history);
  }
});
controls.workspace({
  hasSeenSplash: !shouldShowSplash(
    matchMedia(phoneViewportQuery).matches,
    opensDesignLink,
    browserSessionStorage,
  ),
});
hud.setLocator(locateClientPoint);
hud.setProjector(projectLocation);
terrain3d.subscribeDraw(() => {
  hud.notifyProjectionChanged();
});
mountStudio(controls, terrainSvgElement, outputRenderer, cropPreview, hud, compareScenes);
const viewport = getRequiredElement(document, '#studio-viewport', HTMLElement);

const resizeViewport = () => {
  const nextWidth = Math.max(1, viewport.clientWidth);
  const nextHeight = Math.max(1, viewport.clientHeight);

  terrainSvgElement.setAttribute('viewBox', `0 0 ${nextWidth} ${nextHeight}`);
  clearTimeout(viewportResizeDebounceTimer);
  viewportResizeDebounceTimer = setTimeout(() => {
    width = nextWidth;
    height = nextHeight;
    baseHeightField = sampleTerrain(terrain, width, height, terrainSettings);
    renderCurrentLandscape();
  }, engineConfiguration.resizeDebounceMs);
};

new ResizeObserver(resizeViewport).observe(viewport);
width = Math.max(1, viewport.clientWidth);
height = Math.max(1, viewport.clientHeight);
baseHeightField = sampleTerrain(terrain, width, height, terrainSettings);
applyPageStyle();
subscribeToTheme(applyPageStyle);
renderCurrentLandscape();

// Design links open the 2D design they encode. A fresh visit opens the default real location in 3D
// and leaves the address bare until the design is edited, so reloading returns to that default.
if (opensDesignLink) {
  synchronizeDesignUrl();
} else {
  void openDefaultLocation();
}

requestAnimationFrame(() => {
  console.info(
    JSON.stringify({
      event: 'landscape_ready',
      seed: settings.seed,
      width,
      height,
      samples: baseHeightField.values.length,
      duration_ms: Number((performance.now() - startupStartedAtMs).toFixed(1)),
    }),
  );
});

/** Starts 3D first so the default location builds straight into the 3D scene. */
async function openDefaultLocation(): Promise<void> {
  await controls.selectView('3d');
  await controls.useCoordinates();
}

/** Keeps the active geographic patch centered as the viewport changes. */
function sampleLoadedTerrain(x: number, y: number): number {
  if (!realTerrain) {
    throw new Error('Real terrain is unavailable.');
  }

  return realTerrain.sample(x, y, width, height);
}
