import {
  defaultHeightExaggeration,
  defaultTerrainModelSettings,
  getSuggestedExaggeration,
  validateTerrainModelSettings,
  type TerrainModelSettings,
} from '../terrain-model';
import { defaultTerrainCrop, type TerrainCropSettings } from '../terrain-crop';
import {
  defaultContourEngraving,
  type ContourEngravingSettings,
} from '../terrain-contour-engraving';
import {
  defaultTerrainLighting,
  getDaylightCycleLighting,
  getDaylightCyclePhase,
  getSuggestedTerrainLightDirection,
  type TerrainLightingSettings,
} from '../terrain-lighting';
import {
  defaultRotationSeconds,
  defaultTerrainCameraSettings,
  terrainViewPresets,
  type CameraPose,
  type TerrainCameraSettings,
  type TerrainViewPreset,
  type TurntableDirection,
} from '../terrain-camera';
import type { CameraShot, CameraShotBlocker, CapturedCameraShot } from '../terrain-camera-shots';
import { terrainMaterialPresets, type LandFinish, type WaterFinish } from '../terrain-materials';
import {
  copyElevationGradient,
  elevationGradientPresets,
  getLandscapeGradientKey,
  landscapeGradientPresets,
  validateElevationGradient,
  type ElevationGradientSettings,
} from '../terrain-elevation-gradient';
import {
  defaultRealTerrainPreset,
  realTerrainPresetGroups,
  realTerrainPresets,
} from '../constants/real-terrain';
import { loadBrowserRealTerrain } from '../browser-real-terrain';
import { validateRealContourInterval } from '../real-terrain-contours';
import type { RealTerrain } from '../real-terrain';
import type { DesignSettings, ValidatedDesignSettings } from '../types/design';
import type { OperationError, Result } from '../types/operations';
import { parseGpx, routeStats, simplifyRoute } from '../gpx';
import type { RouteStats } from '../types/route';
import type { ActiveRoute, GeoPoint, RouteEditing } from '../types/terrain-analysis';
import { reduceRouteEditing, type RouteEditingAction } from './route-editing';
import { frameRoute } from '../route-framing';
import { defaultSlopeThresholdPercent } from '../constants/route-analysis';
import type { WaterStyle } from '../terrain-3d';
import type { FloorStyle } from '../terrain-floor-styles';
import type { TerrainStillScale } from '../export/still-export';
import { defaultRoadStyle, roadDetailClasses, roadSpanLimitsKm } from '../constants/roads';
import { track } from '../analytics';
import { operationErrorCodes } from '../constants/operations';
import { designPalettePresets, type PalettePresetName } from '../constants/palettes';
import { parseDesignParameters } from '../design-settings';
import type { SavedDesign } from '../saved-designs';
import type { RoadNetwork, RoadStyle } from '../types/roads';
import {
  clampDivider,
  defaultDividerFraction,
  getComparePresetPatch,
  isComparePresetId,
} from './wipe-compare';
import { createRoadNetworkLoader, getRoadPlacementKey } from './road-loader';
import { createPlaceSearcher } from './place-searcher';
import { describeTerrainFault, type StudioFault, type TerrainLoadProgress } from './terrain-fault';
import type { PlaceMatch } from '../place-search';
import {
  addSavedPlace,
  isSameSavedPlace,
  readSavedPlaces,
  writeSavedPlaces,
  type SavedPlace,
} from '../saved-places';
import { defaultGrassStyle, grassPresets } from '../constants/grass';
import type { GrassStyle } from '../types/grass';
import { getSuggestedRoadWidthMm } from '../road-ribbons';
import { createFrameAssembly } from '../frame/frame-assembly';
import {
  createStudioFrame,
  defaultFrameStudioSettings,
  explainFrameStudioError,
  type FrameStudioSettings,
} from '../frame/frame-studio-settings';
import type { FrameAssembly, FramePart, FramePartId } from '../types/frame';
import type { ExportJob } from '../ui/job-list';
import type { SheetSnap } from '../ui/sheet-handle';
import {
  cascadePosition,
  nextZIndex,
  type PanelPosition,
  type PinnedGroupPlacement,
} from '../ui/layout-manager';

export type StudioView = '2d' | '3d';
export type InspectorSection =
  | 'Terrain'
  | 'Contours'
  | 'Colour'
  | 'Camera'
  | 'Orbit'
  | 'Director'
  | 'Scene'
  | 'Overlays'
  | 'Route'
  | 'Model'
  | 'Frame';
export const threeDOnlySections: readonly InspectorSection[] = [
  'Camera',
  'Orbit',
  'Director',
  'Model',
  'Frame',
];
export interface SceneSettings {
  contours: boolean;
  engraving: ContourEngravingSettings;
  materialPreset: string;
  surface: boolean;
  base: boolean;
  landFinish: LandFinish;
  surfaceMatch: boolean;
  surfaceColor: string;
  gradient: ElevationGradientSettings;
  gradientPreset: string;
  /** 'location' follows the loaded place's landscape; any manual gradient choice sticks as 'user'. */
  gradientSource: 'location' | 'user';
  ground: boolean;
  groundMatch: boolean;
  groundColor: string;
  mapGrid: boolean;
  floorStyle: FloorStyle;
  waterStyle: WaterStyle;
  waterFinish: WaterFinish;
  waterMatch: boolean;
  waterColor: string;
  waterOpacity: number;
  previewWater: boolean;
  previewWaterLevel: number;
  lighting: TerrainLightingSettings;
  customLightDirection: boolean;
  /** Sweeps time of day and sun bearing; any manual lighting edit pauses it. */
  daylightCycle: { enabled: boolean; daySeconds: number };
  camera: TerrainCameraSettings;
  rotating: boolean;
  rotationSeconds: number;
  rotationDirection: TurntableDirection;
  roads: RoadStyle;
  grass: GrassStyle;
}
/** Mapped roads for the loaded real terrain; never part of design links. */
export interface RoadNetworkState {
  network?: RoadNetwork;
  /** The source patch `network` belongs to, from `getRoadPlacementKey`. */
  sourceKey: string;
  loading: boolean;
  status: string;
  /** The last download failed in a way a later attempt may fix. */
  canRetry: boolean;
  /** The last download failed; `status` explains why. */
  hasFailed: boolean;
}
/** The session's one route: geometry, editing mode and view state. Session-only, never in links. */
export interface WorkspaceRoute {
  active: ActiveRoute;
  editing: RouteEditing;
  isVisible: boolean;
  /** Recorded-point stats; imported routes only (drawn routes get terrain analysis instead). */
  stats?: RouteStats;
  /** Profile cursor: distance along the route being inspected. */
  inspectedDistanceMeters?: number;
}

/** A new drawing or GPX load waiting for the user to confirm discarding the current route (REQ-19). */
export type PendingRouteReplacement =
  { kind: 'draw' } | { kind: 'import'; text: string; fallbackName: string };

export interface RouteReplaceResult {
  needsConfirmation: boolean;
}

/** Douglas-Peucker tolerance for drawn routes: below a pixel at any supported span. */
const routeSimplifyToleranceMeters = 5;

export interface TerrainSourceState {
  selected: 'generated' | 'real';
  terrain?: RealTerrain;
  place: string;
  latitude: number;
  longitude: number;
  spanKm: number;
  maxDepth: number;
  elevationFloor?: number;
  interval: 'auto' | number;
  fixedInterval: number;
  hatching: boolean;
  loading: boolean;
  status: string;
  /** Tiles downloaded so far; null before the first report and whenever nothing is loading. */
  loadProgress: TerrainLoadProgress | null;
  /** The last load failure, shown as a FaultCard until dismissed, retried or superseded. */
  fault: StudioFault | null;
  /** Steps through preset locations in menu order, waiting after each load settles. */
  autoplay: { enabled: boolean; delaySeconds: number };
}
export type StudioPage = 'studio' | 'library' | 'presets' | 'account';
/** `system` swaps the canvas for the design-system gallery (desktop only). */
export type StudioMode = 'studio' | 'system';
/** The active on-canvas tool; `none` leaves every canvas pointer event to the terrain. */
export type ToolMode = 'none' | 'crop' | 'measure' | 'presets' | 'route';

export interface StudioState {
  design: ValidatedDesignSettings;
  source: TerrainSourceState;
  roads: RoadNetworkState;
  scene: SceneSettings;
  model: {
    dimensions: TerrainModelSettings;
    crop: TerrainCropSettings;
    exaggeration: number;
    /** Real locations suggest a height until the user moves the slider. */
    autoExaggeration: boolean;
  };
  /** Session-only. `assembly` waits for the 3D model's overall height. */
  frame: { settings: FrameStudioSettings; assembly?: Result<FrameAssembly> };
  workspace: {
    view: StudioView;
    activating: boolean;
    collapsed: boolean;
    sections: Record<StudioView, InspectorSection>;
    exporting: boolean;
    dossierOpen: boolean;
    /** Phone bottom-sheet height. Session-only: never serialized into links. */
    sheetSnap: SheetSnap;
    /** Control groups floating outside the inspector (desktop). Session-only: never serialized. */
    pinnedGroups: readonly PinnedGroupPlacement[];
    /** The open command palette and its query; null while closed. */
    palette: { query: string } | null;
    /** Phone root page; `studio` keeps the WebGL canvas visible. Session-only, no router. */
    page: StudioPage;
    /** False only on a phone's first visit of the session; see `src/studio/pages/splash-session.ts`. */
    hasSeenSplash: boolean;
    /** The GPX route over the terrain. Session-only: never in design links. */
    route: WorkspaceRoute | null;
    /** Why the last GPX file was refused; the previous route stays. */
    routeFault: OperationError | null;
    /** Shown as the replace-confirm dialog until confirmed or cancelled. */
    routeReplacement: PendingRouteReplacement | null;
    /** The A/B preset wipe. Session-only; `null` while no preset is being compared. */
    compare: { presetId: string; dividerFraction: number } | null;
    /** The desktop preset strip. Session-only. */
    comparePresetsOpen: boolean;
    /** Session-only. Crop applies to the 3D model, so the crop frame shows only in 3D. */
    toolMode: ToolMode;
    /** Session-only; the mode flip in `mode-flip.ts` animates between the two. */
    mode: StudioMode;
    /** The design-system part on the stage, by registry id. */
    systemPartId: string;
  };
  seedLocked: boolean;
  status: string;
  manualLink: string;
  /** Sequential frame-part STL downloads, oldest first. Cleared when the next batch starts. */
  exportJobs: readonly ExportJob[];
  /** Measured from the rendered model; `spanKm` is its longer geographic side. */
  metrics: { height?: number; layerHeight?: number; spanKm?: number };
  /** The 3D camera, published at most 20 times a second; undefined until the 3D view first draws. */
  cameraPose?: CameraPose;
  /** Searched places that loaded, most recent first; kept in browser storage. */
  savedPlaces: SavedPlace[];
  /** Bookmarked 3D views for the director tour. Session-only; cleared when the terrain changes. */
  cameraShots: { shots: readonly CapturedCameraShot[]; isPlaying: boolean };
}
export interface StudioEffects {
  /** Location and source changes morph the 3D terrain; interval and hatching edits cut. */
  applyTerrain(terrain: RealTerrain | undefined, shouldTransition: boolean): void;
  activate(view: StudioView): Promise<void>;
  sceneChanged(previous: SceneSettings): void;
  modelChanged(): void;
  resetCamera(): void;
  applyViewPreset(preset: TerrainViewPreset): void;
  setCameraDirection(azimuthDegrees: number, elevationDegrees: number): void;
  /** Spike: drops into first person at a viewport point (the orbit centre when omitted); false on a miss. */
  walkAt(clientX?: number, clientY?: number): boolean;
  pickFocus(): Promise<boolean>;
  /** Shot actions return why the 3D view refused them; undefined (or a capture) when they ran. */
  captureCameraShot(): { shot: CameraShot; thumbnailUrl: string } | CameraShotBlocker;
  flyToCameraShot(shot: CameraShot): CameraShotBlocker | undefined;
  playCameraShots(shots: readonly CameraShot[], onStop: () => void): CameraShotBlocker | undefined;
  stopCameraShots(): void;
  /** Resolves to the saved image's pixel size. */
  downloadStill(scale: TerrainStillScale): Promise<{ width: number; height: number }>;
  downloadStl(): void;
  /** A road network arrived or was cleared; style edits go through `sceneChanged`. */
  roadsChanged(): void;
  /** The frame assembly was rebuilt; the 3D preview should show its parts. */
  frameChanged(): void;
  downloadFrameStl(part: FramePart): void;
}

export interface DesignControlActions {
  getSettings: () => ValidatedDesignSettings;
  updateSettings: (settings: DesignSettings) => boolean;
  newLandscape: () => void;
  isSeedLocked: boolean;
  lockSeed: (locked: boolean) => void;
  getShareUrl: () => string;
  copyLink: (url: string) => Promise<Result<void>>;
}
export interface StudioController {
  getSnapshot: () => StudioState;
  subscribe: (listener: () => void) => () => void;
  connect: (effects: StudioEffects) => void;
  sync: () => void;
  notify: (message: string) => void;
  workspace: (patch: Partial<StudioState['workspace']>) => void;
  /** Floats a group in a cascaded panel on top of the others; pinning twice is a no-op. */
  pinGroup: (id: string) => void;
  /** Returns a pinned group to its section; docking an unpinned group is a no-op. */
  dockGroup: (id: string) => void;
  /** Places a pinned panel; the caller has already snapped and clamped `position`. */
  moveGroup: (id: string, position: PanelPosition) => void;
  /** Brings a pinned panel above the others. */
  raiseGroup: (id: string) => void;
  dismissManualLink: () => void;
  /**
   * Parses and shows a GPX route; an invalid file sets `workspace.routeFault` and keeps the old
   * route. Over a non-empty route it only sets `workspace.routeReplacement` and waits.
   */
  loadRoute: (text: string, fallbackName?: string) => RouteReplaceResult;
  /** Starts a new empty drawn route in drawing mode, asking first like `loadRoute`. */
  startRouteDrawing: () => RouteReplaceResult;
  /** Runs the pending replacement; a confirmed drawing also hands the canvas to the Route tool. */
  confirmRouteReplacement: () => void;
  cancelRouteReplacement: () => void;
  placeRouteWaypoint: (point: GeoPoint) => void;
  moveRouteWaypoint: (index: number, point: GeoPoint) => void;
  /** Inserts between waypoint `segmentIndex` and the next. */
  insertRouteWaypoint: (segmentIndex: number, point: GeoPoint) => void;
  selectRouteWaypoint: (index: number | undefined) => void;
  /** Deletes the selected waypoint. */
  deleteRouteWaypoint: () => void;
  finishRoute: () => void;
  editRoute: () => void;
  escapeRoute: () => void;
  reverseRoute: () => void;
  clearRoute: () => void;
  setRouteSlopeThreshold: (percent: number) => void;
  inspectRoute: (distanceMeters: number | undefined) => void;
  /** Loads real terrain centred on the route at a span that holds it; a no-op without a route. */
  centreTerrainOnRoute: () => Promise<void>;
  /** Library restore: installs a route in viewing mode, replacing any current one. */
  setRoute: (route: ActiveRoute) => void;
  /**
   * Library restore, in order: design link, then real terrain (awaited so analysis sees it), then
   * the route. A design without a route leaves the current route alone.
   */
  restoreSavedDesign: (saved: SavedDesign) => Promise<Result<void>>;
  toggleRoute: () => void;
  design: (patch: Partial<DesignSettings>) => boolean;
  /** Applies a named palette preset and reports it; the one entry point for every preset control. */
  applyPalettePreset: (name: PalettePresetName) => boolean;
  /** Starts (or retargets) the A/B wipe against a palette preset; unknown ids are ignored. */
  startCompare: (presetId: string) => void;
  /** Moves the wipe divider, clamped to 0-1; a no-op while not comparing. */
  moveDivider: (fraction: number) => void;
  /** Applies the compared preset through `design()`, then ends the compare. */
  applyCompare: () => void;
  endCompare: () => void;
  newLandscape: () => void;
  lockSeed: (value: boolean) => void;
  copyLink: () => Promise<void>;
  selectSection: (section: InspectorSection) => void;
  selectView: (view: StudioView) => Promise<void>;
  scene: (patch: Partial<SceneSettings>, custom?: boolean) => void;
  material: (key: string) => void;
  lighting: (patch: Partial<TerrainLightingSettings>) => void;
  resetLighting: () => void;
  camera: (patch: Partial<TerrainCameraSettings>) => void;
  resetCameraSettings: () => void;
  applyViewPreset: (preset: TerrainViewPreset) => void;
  setCameraDirection: (azimuthDegrees: number, elevationDegrees: number) => void;
  walkAt: (clientX?: number, clientY?: number) => boolean;
  /** Arms a one-off terrain click that sets the depth-of-field focus point. */
  pickFocus: () => Promise<void>;
  model: (patch: Partial<StudioState['model']>) => boolean;
  dimensions: (patch: Partial<TerrainModelSettings>) => boolean;
  frame: (patch: Partial<FrameStudioSettings>) => void;
  /** True when the download started; failures are reported through `status`. */
  downloadFrameStl: (partId: FramePartId) => boolean;
  /** Downloads the parts one after another, listing each in `exportJobs`. */
  downloadFrameStlParts: (partIds: readonly FramePartId[]) => Promise<void>;
  metrics: (height: number, layerHeight?: number) => void;
  cameraPose: (pose: CameraPose) => void;
  /** Reports the model's longer geographic side; auto road width follows it. */
  modelSpan: (spanKm: number | undefined) => void;
  source: (patch: Partial<TerrainSourceState>) => void;
  useGenerated: () => void;
  /** Switches to real terrain, opening its location controls and loading the selected place. */
  useCoordinates: () => Promise<void>;
  loadTerrain: () => Promise<void>;
  /** Stops the running terrain download; tiles already cached stay cached. */
  cancelTerrainLoad: () => void;
  dismissTerrainFault: () => void;
  autoplay: (patch: Partial<TerrainSourceState['autoplay']>) => Promise<void>;
  daylightCycle: (patch: Partial<SceneSettings['daylightCycle']>) => void;
  /** Edits road style; switching roads on for real terrain fetches them once. */
  roads: (patch: Partial<RoadStyle>) => void;
  /** Downloads roads again after a retryable failure. */
  retryRoads: () => void;
  /** Resolves undefined when a newer search superseded this one. */
  searchPlaces: (query: string) => Promise<Result<PlaceMatch[]> | undefined>;
  /** Loads a search match; once its terrain loads it is saved and listed before the presets. */
  loadSearchedPlace: (match: PlaceMatch, spanKm?: number) => Promise<void>;
  /** Edits grass; picking a preset applies its look, and hand-editing the look makes it custom. */
  grass: (patch: Partial<GrassStyle>) => void;
  interval: (value: 'auto' | number) => boolean;
  hatching: (value: boolean) => void;
  resetCamera: () => void;
  /** Bookmarks the current 3D view; a no-op outside 3D. */
  saveCameraShot: () => void;
  removeCameraShot: (id: number) => void;
  clearCameraShots: () => void;
  flyToCameraShot: (id: number) => void;
  /** Starts the looping tour, or stops it when it is playing. */
  toggleCameraShotPlayback: () => void;
  stopCameraShots: () => void;
  /** True when the download started; failures are reported through `status`. */
  downloadStl: () => boolean;
  downloadStill: (scale: TerrainStillScale) => Promise<void>;
}

/** The controller and its current snapshot, passed to the studio panels. */
export interface PanelProps {
  controller: StudioController;
  state: StudioState;
}

/** Pause between part downloads so each job paints and the browser sees separate saves. */
const exportJobPaceMs = 120;

/** A binary STL is an 84-byte header plus 50 bytes per triangle. */
export function estimateBinaryStlBytes(part: FramePart): number {
  return 84 + (part.solid.indices.length / 3) * 50;
}

/** Twenty updates a second keeps the sun smooth without flooding React with renders. */
const daylightFrameMs = 50;

const cameraShotBlockerMessages: Record<CameraShotBlocker, string> = {
  'not-3d': 'Switch to the 3D view to use shots',
  walking: 'Stop walking to use shots',
};

/** Session state is independent of controls, rendering and version-one URL serialization. */
export function createStudioController(
  actions: DesignControlActions,
  // Roads and place search share one fetch so tests can fake the network once.
  fetchRoads: typeof fetch = (...request) => fetch(...request),
  placeStorage?: Pick<Storage, 'getItem' | 'setItem'>,
): StudioController {
  const place = defaultRealTerrainPreset;
  // Unreadable storage leaves the menu with presets only; saving later reports the problem.
  const savedPlacesResult = placeStorage ? readSavedPlaces(placeStorage) : undefined;
  const natural = terrainMaterialPresets.natural;
  let state: StudioState = {
    design: actions.getSettings(),
    source: {
      selected: 'generated',
      place: `${place.latitude},${place.longitude}`,
      latitude: place.latitude,
      longitude: place.longitude,
      spanKm: place.spanKm,
      maxDepth: 50,
      interval: 'auto',
      fixedInterval: 25,
      hatching: true,
      loading: false,
      status: '',
      loadProgress: null,
      fault: null,
      autoplay: { enabled: false, delaySeconds: 10 },
    },
    scene: {
      contours: true,
      engraving: { ...defaultContourEngraving },
      materialPreset: 'natural',
      surface: true,
      base: true,
      landFinish: natural.landFinish,
      surfaceMatch: false,
      surfaceColor: natural.land,
      gradient: copyElevationGradient({
        enabled: true,
        transition: 'soft',
        stops: elevationGradientPresets.paper.stops,
      }),
      gradientPreset: 'paper',
      gradientSource: 'location',
      ground: true,
      groundMatch: false,
      groundColor: '#b4b4b4',
      mapGrid: true,
      floorStyle: 'survey',
      waterStyle: 'solid',
      waterFinish: 'translucent',
      waterMatch: false,
      waterColor: natural.water,
      waterOpacity: 0.4,
      previewWater: false,
      previewWaterLevel: 0.4,
      lighting: { ...defaultTerrainLighting },
      customLightDirection: false,
      daylightCycle: { enabled: false, daySeconds: 75 },
      camera: { ...defaultTerrainCameraSettings },
      rotating: false,
      rotationSeconds: defaultRotationSeconds,
      rotationDirection: 'counterclockwise',
      roads: { ...defaultRoadStyle },
      grass: { ...defaultGrassStyle },
    },
    roads: { sourceKey: '', loading: false, status: '', canRetry: false, hasFailed: false },
    model: {
      dimensions: { ...defaultTerrainModelSettings },
      crop: { ...defaultTerrainCrop },
      exaggeration: defaultHeightExaggeration,
      autoExaggeration: true,
    },
    frame: { settings: { ...defaultFrameStudioSettings } },
    workspace: {
      view: '2d',
      activating: false,
      collapsed: false,
      sections: { '2d': 'Terrain', '3d': 'Terrain' },
      exporting: false,
      dossierOpen: false,
      sheetSnap: 'half',
      pinnedGroups: [],
      palette: null,
      page: 'studio',
      hasSeenSplash: true,
      route: null,
      routeFault: null,
      routeReplacement: null,
      compare: null,
      comparePresetsOpen: false,
      toolMode: 'none',
      mode: 'studio',
      systemPartId: 'ink',
    },
    seedLocked: actions.isSeedLocked,
    status: '',
    manualLink: '',
    exportJobs: [],
    metrics: {},
    savedPlaces: savedPlacesResult?.ok === true ? savedPlacesResult.data : [],
    cameraShots: { shots: [], isPlaying: false },
  };
  let nextCameraShotId = 1;
  let effects: StudioEffects | undefined;
  let requestVersion = 0;
  let terrainLoadCancel: AbortController | undefined;
  // Saved once its terrain loads, so a failed or superseded load never lists the place.
  let pendingSearchedPlace: SavedPlace | undefined;
  // Procedural mode parks the last real terrain so switching back is instant.
  let autoplayTimer: ReturnType<typeof setTimeout> | undefined;
  let daylightTimer: ReturnType<typeof setInterval> | undefined;
  let parked: { terrain: RealTerrain; fieldsKey: string } | undefined;
  let loadedFieldsKey = '';
  const listeners = new Set<() => void>();
  const roadLoader = createRoadNetworkLoader(fetchRoads);

  const saveSearchedPlace = (
    place: SavedPlace | undefined,
    location: { latitude: number; longitude: number },
  ) => {
    if (!place || !isSameSavedPlace(place, location)) {
      return;
    }

    const stored = placeStorage ? readSavedPlaces(placeStorage) : undefined;
    const savedPlaces = addSavedPlace(stored?.ok === true ? stored.data : state.savedPlaces, place);
    const written = placeStorage ? writeSavedPlaces(placeStorage, savedPlaces) : undefined;

    state = { ...state, savedPlaces };

    if (written?.ok === false) {
      controller.notify(written.error.message);
    }
  };

  const placeSearcher = createPlaceSearcher(fetchRoads);

  const publish = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const notify = (message: string) => {
    state = { ...state, status: message };
    publish();
  };

  const setCameraShots = (patch: Partial<StudioState['cameraShots']>) => {
    state = { ...state, cameraShots: { ...state.cameraShots, ...patch } };
    publish();
  };

  /** Sets the stack; a running tour restarts on the new stack so it never visits removed shots. */
  const replaceCameraShots = (shots: readonly CapturedCameraShot[]) => {
    const blocker =
      state.cameraShots.isPlaying && shots.length > 0 ? playCameraShotTour(shots) : undefined;

    if (blocker) {
      notify(cameraShotBlockerMessages[blocker]);
    } else if (state.cameraShots.isPlaying && shots.length === 0) {
      effects?.stopCameraShots();
    }

    setCameraShots({ shots });
  };

  /** Starts the looping tour; returns why it could not start. */
  const playCameraShotTour = (
    shots: readonly CapturedCameraShot[],
  ): CameraShotBlocker | undefined => {
    const blocker = effects
      ? effects.playCameraShots(shots, () => {
          setCameraShots({ isPlaying: false });
        })
      : 'not-3d';

    setCameraShots({ isPlaying: blocker === undefined });

    return blocker;
  };

  /** Shots frame the old landscape, so a new one starts with an empty stack. */
  const discardCameraShots = () => {
    if (state.cameraShots.shots.length > 0) {
      effects?.stopCameraShots();
      setCameraShots({ shots: [], isPlaying: false });
    }
  };

  const workspace = (patch: Partial<StudioState['workspace']>) => {
    state = { ...state, workspace: { ...state.workspace, ...patch } };
    publish();
  };

  let drawnRouteCount = 0;

  const installRoute = (active: ActiveRoute) => {
    workspace({
      routeFault: null,
      route: toWorkspaceRoute(active, { mode: 'viewing' }, true, null),
    });
  };

  const applyRouteAction = (action: RouteEditingAction) => {
    const { route } = state.workspace;
    const next = reduceRouteEditing(
      { route: route?.active ?? null, editing: route?.editing ?? { mode: 'viewing' } },
      action,
    );

    workspace({
      route:
        next.route === null
          ? null
          : toWorkspaceRoute(next.route, next.editing, route?.isVisible ?? true, route),
    });
  };

  // An empty drawn route has nothing to lose, so replacing it needs no confirmation.
  const requestReplacement = (pending: PendingRouteReplacement): boolean => {
    if ((state.workspace.route?.active.waypoints.length ?? 0) === 0) {
      return false;
    }

    workspace({ routeReplacement: pending });

    return true;
  };

  const importRoute = (
    text: string,
    fallbackName: string,
    isConfirmed: boolean,
  ): RouteReplaceResult => {
    const parsed = parseGpx(text);

    if (!parsed.ok) {
      workspace({ routeFault: parsed.error });

      return { needsConfirmation: false };
    }

    if (!isConfirmed && requestReplacement({ kind: 'import', text, fallbackName })) {
      return { needsConfirmation: true };
    }

    const { name, points, waypoints } = parsed.data;
    const routeName = name ?? fallbackName;

    installRoute({
      id: createRouteId(routeName, points),
      name: routeName,
      provenance: 'imported',
      waypoints: simplifyRoute(points, routeSimplifyToleranceMeters).map(toGeoPoint),
      originalPoints: points,
      namedWaypoints: waypoints,
      slopeThresholdPercent: defaultSlopeThresholdPercent,
    });
    track('route_import', {});

    return { needsConfirmation: false };
  };

  const beginDrawing = () => {
    drawnRouteCount += 1;
    applyRouteAction({ type: 'start-drawing', id: `drawn-${drawnRouteCount}` });
    workspace({ routeFault: null });
  };

  const updatePinnedGroup = (
    id: string,
    update: (pinned: PinnedGroupPlacement) => PinnedGroupPlacement,
  ) => {
    const { pinnedGroups } = state.workspace;
    const nextPinnedGroups = pinnedGroups.map((pinned) =>
      pinned.id === id ? update(pinned) : pinned,
    );

    if (nextPinnedGroups.some((pinned, index) => pinned !== pinnedGroups[index])) {
      workspace({ pinnedGroups: nextPinnedGroups });
    }
  };

  const findFramePart = (partId: FramePartId): FramePart | undefined => {
    const assembly = state.frame.assembly;

    return assembly?.ok === true ? assembly.data.parts.find(({ id }) => id === partId) : undefined;
  };

  const setExportJobs = (exportJobs: readonly ExportJob[]) => {
    state = { ...state, exportJobs };
    publish();
  };

  const updateExportJob = (jobId: string, patch: Partial<ExportJob>) => {
    setExportJobs(state.exportJobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job)));
  };

  /** Frames fit the model, so any model, height or frame shape edit rebuilds the assembly. */
  const rebuildFrame = () => {
    const height = state.metrics.height;
    const { settings, assembly: previous } = state.frame;

    // No frame stays empty whatever the model does, so skip the preview round trip.
    if (settings.preset === 'none' && previous?.ok === true && previous.data.parts.length === 0) {
      return;
    }

    const built =
      height === undefined
        ? undefined
        : createFrameAssembly(state.model.dimensions, height, createStudioFrame(settings));
    const explanation = built?.ok === false ? explainFrameStudioError(settings) : undefined;
    const assembly: Result<FrameAssembly> | undefined =
      built?.ok === false && explanation !== undefined
        ? {
            ok: false,
            error: { ...built.error, message: `${explanation} (${built.error.message})` },
          }
        : built;

    state = { ...state, frame: { ...state.frame, assembly } };
    effects?.frameChanged();
  };

  const sync = () => {
    state = { ...state, design: actions.getSettings() };
    publish();
  };

  let latestFocusPickId = 0;

  const applySource = (terrain: RealTerrain | undefined, shouldTransition: boolean) => {
    const previousScene = state.scene;
    const previousLocation = state.source.terrain?.location;
    const nextLocation = terrain?.location;
    const locationChanged =
      previousLocation?.latitude !== nextLocation?.latitude ||
      previousLocation?.longitude !== nextLocation?.longitude;

    state = { ...state, source: { ...state.source, terrain } };
    const roadSourceKey = getRoadPlacementKey(getRoadPlacement(terrain));
    const roadSourceChanged = roadSourceKey !== state.roads.sourceKey;

    // Stale roads are dropped before the renderer sees the new terrain.
    if (roadSourceChanged) {
      roadLoader.cancel();
      state = {
        ...state,
        roads: {
          sourceKey: roadSourceKey,
          loading: false,
          status: '',
          canRetry: false,
          hasFailed: false,
        },
      };
    }

    if (locationChanged && state.scene.gradientSource === 'location') {
      state = { ...state, scene: applyLocationGradient(state.scene, nextLocation) };
    }

    if (locationChanged && !state.scene.customLightDirection) {
      state = {
        ...state,
        scene: {
          ...state.scene,
          lighting: {
            ...state.scene.lighting,
            direction: getSuggestedTerrainLightDirection(nextLocation?.latitude),
          },
        },
      };
    }

    if (locationChanged) {
      discardCameraShots();
    }

    if (locationChanged && state.model.autoExaggeration) {
      state = { ...state, model: applySuggestedExaggeration(state.model, terrain) };
    }

    effects?.applyTerrain(terrain, shouldTransition);

    // After applyTerrain, so the renderer can blend the new gradient into the terrain morph.
    if (state.scene !== previousScene) {
      effects?.sceneChanged(previousScene);
    }

    publish();

    if (roadSourceChanged && state.scene.roads.enabled) {
      void loadRoads();
    }
  };

  const setRoads = (patch: Partial<RoadNetworkState>) => {
    state = { ...state, roads: { ...state.roads, ...patch } };
    publish();
  };

  const loadRoads = async () => {
    const placement = getRoadPlacement(state.source.terrain);
    const sourceKey = getRoadPlacementKey(placement);

    if (!placement || state.roads.network || state.roads.loading) {
      return;
    }

    setRoads({
      loading: true,
      status: 'Downloading OpenStreetMap roads…',
      canRetry: false,
      hasFailed: false,
    });
    let result: Awaited<ReturnType<typeof roadLoader.load>>;

    try {
      result = await roadLoader.load(placement);
    } catch (error) {
      result = {
        ok: false,
        error: {
          code: operationErrorCodes.mapDataFailed,
          message: error instanceof Error ? error.message : 'Roads could not load. Retry later.',
          retryable: true,
        },
      };
    }

    // A newer source owns the road state now; its own load reports instead.
    if (result === undefined || sourceKey !== state.roads.sourceKey) {
      return;
    }

    if (!result.ok) {
      setRoads({
        loading: false,
        status: result.error.message,
        canRetry: result.error.retryable,
        hasFailed: true,
      });

      return;
    }

    setRoads({ network: result.data, loading: false, status: '' });
    effects?.roadsChanged();
  };

  const controller: StudioController = {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    connect(value: StudioEffects) {
      effects = value;
    },
    sync,
    notify,
    workspace,
    pinGroup(id: string) {
      const { pinnedGroups } = state.workspace;

      if (pinnedGroups.some((pinned) => pinned.id === id)) {
        return;
      }

      workspace({
        pinnedGroups: [
          ...pinnedGroups,
          { id, position: cascadePosition(pinnedGroups.length), zIndex: nextZIndex(pinnedGroups) },
        ],
      });
    },
    dockGroup(id: string) {
      const { pinnedGroups } = state.workspace;

      if (pinnedGroups.some((pinned) => pinned.id === id)) {
        workspace({ pinnedGroups: pinnedGroups.filter((pinned) => pinned.id !== id) });
      }
    },
    moveGroup(id: string, position: PanelPosition) {
      updatePinnedGroup(id, (pinned) =>
        pinned.position.xPx === position.xPx && pinned.position.yPx === position.yPx
          ? pinned
          : { ...pinned, position },
      );
    },
    raiseGroup(id: string) {
      const { pinnedGroups } = state.workspace;

      updatePinnedGroup(id, (pinned) =>
        pinnedGroups.every((other) => other === pinned || other.zIndex < pinned.zIndex)
          ? pinned
          : { ...pinned, zIndex: nextZIndex(pinnedGroups) },
      );
    },
    loadRoute: (text, fallbackName = 'GPX route') => importRoute(text, fallbackName, false),
    startRouteDrawing() {
      if (requestReplacement({ kind: 'draw' })) {
        return { needsConfirmation: true };
      }

      beginDrawing();

      return { needsConfirmation: false };
    },
    confirmRouteReplacement() {
      const pending = state.workspace.routeReplacement;

      if (pending === null) {
        return;
      }

      workspace({ routeReplacement: null });

      if (pending.kind === 'import') {
        importRoute(pending.text, pending.fallbackName, true);

        return;
      }

      beginDrawing();
      workspace({ toolMode: 'route' });
    },
    cancelRouteReplacement() {
      workspace({ routeReplacement: null });
    },
    placeRouteWaypoint: (point) => {
      applyRouteAction({ type: 'place', point });
    },
    moveRouteWaypoint: (index, point) => {
      applyRouteAction({ type: 'drag', index, point });
    },
    insertRouteWaypoint: (segmentIndex, point) => {
      applyRouteAction({ type: 'insert', segmentIndex, point });
    },
    selectRouteWaypoint: (index) => {
      applyRouteAction({ type: 'select', index });
    },
    deleteRouteWaypoint: () => {
      applyRouteAction({ type: 'delete' });
    },
    finishRoute: () => {
      applyRouteAction({ type: 'finish' });
    },
    editRoute: () => {
      applyRouteAction({ type: 'edit' });
    },
    escapeRoute: () => {
      applyRouteAction({ type: 'escape' });
    },
    reverseRoute: () => {
      applyRouteAction({ type: 'reverse' });
    },
    clearRoute() {
      workspace({ route: null, routeFault: null });
    },
    setRouteSlopeThreshold: (percent) => {
      applyRouteAction({ type: 'set-threshold', percent });
    },
    inspectRoute(distanceMeters) {
      const { route } = state.workspace;

      if (route && route.inspectedDistanceMeters !== distanceMeters) {
        workspace({
          route: toWorkspaceRoute(
            route.active,
            route.editing,
            route.isVisible,
            route,
            distanceMeters,
          ),
        });
      }
    },
    setRoute(active) {
      installRoute(active);
    },
    async centreTerrainOnRoute() {
      const { route } = state.workspace;
      const framing = route && frameRoute(route.active.originalPoints ?? route.active.waypoints);

      if (!framing) {
        return;
      }

      void controller.autoplay({ enabled: false });
      controller.source({
        selected: 'real',
        place: `${framing.latitude},${framing.longitude}`,
        ...framing,
      });
      await controller.loadTerrain();
    },
    async restoreSavedDesign(saved) {
      const settings = readDesignLink(saved.link);

      if (settings === null) {
        return {
          ok: false,
          error: {
            code: operationErrorCodes.invalidSettings,
            message: `${saved.name} could not be opened because its saved link is invalid. Delete it and save again.`,
            retryable: false,
          },
        };
      }

      controller.design(settings);

      if (saved.terrain) {
        controller.source({ selected: 'real', ...saved.terrain });
        await controller.loadTerrain();
      }

      if (saved.route) {
        const { id, name, provenance, points, namedWaypoints, slopeThresholdPercent } = saved.route;

        // Imported routes get their recorded elevations back so GPX export never terrain-fills them.
        installRoute({
          id,
          name,
          provenance,
          waypoints: points.map(({ latitude, longitude }) => ({ latitude, longitude })),
          namedWaypoints,
          slopeThresholdPercent,
          ...(provenance === 'imported' && { originalPoints: points }),
        });
      }

      return { ok: true, data: undefined };
    },
    toggleRoute() {
      const { route } = state.workspace;

      if (route) {
        workspace({ route: { ...route, isVisible: !route.isVisible } });
      }
    },
    dismissManualLink() {
      state = { ...state, manualLink: '' };
      publish();
    },
    design(patch: Partial<DesignSettings>) {
      const ok = actions.updateSettings({ ...state.design, ...patch });

      if (ok) {
        sync();
      }

      return ok;
    },
    applyPalettePreset(name: PalettePresetName) {
      const ok = controller.design(designPalettePresets[name]);

      if (ok) {
        track('preset_apply', { name });
      }

      return ok;
    },
    startCompare(presetId: string) {
      if (!isComparePresetId(presetId)) {
        return;
      }

      workspace({
        compare: {
          presetId,
          dividerFraction: state.workspace.compare?.dividerFraction ?? defaultDividerFraction,
        },
      });
    },
    moveDivider(fraction: number) {
      const { compare } = state.workspace;

      if (compare !== null) {
        workspace({ compare: { ...compare, dividerFraction: clampDivider(fraction) } });
      }
    },
    applyCompare() {
      const { compare } = state.workspace;

      if (compare !== null && isComparePresetId(compare.presetId)) {
        controller.design(getComparePresetPatch(compare.presetId));
      }

      workspace({ compare: null });
    },
    endCompare() {
      if (state.workspace.compare !== null) {
        workspace({ compare: null });
      }
    },
    newLandscape() {
      if (!state.seedLocked) {
        discardCameraShots();
        actions.newLandscape();
        sync();
      }
    },
    lockSeed(value: boolean) {
      state = { ...state, seedLocked: value };
      actions.lockSeed(value);
      publish();
    },
    async copyLink() {
      const url = actions.getShareUrl();
      const result = await actions.copyLink(url);

      track('share_link', { ok: result.ok });

      state = { ...state, manualLink: result.ok ? '' : url };
      notify(
        result.ok
          ? 'Style link copied. Location and 3D settings are excluded.'
          : result.error.message,
      );
    },
    selectSection(section: InspectorSection) {
      if (getHiddenSections(state).includes(section)) {
        return;
      }

      workspace({
        collapsed: false,
        sections: { ...state.workspace.sections, [state.workspace.view]: section },
      });
    },
    async selectView(view: StudioView) {
      if (state.workspace.activating || view === state.workspace.view) {
        return;
      }

      workspace({ activating: true });

      try {
        await effects?.activate(view);
        workspace({ view, activating: false });
        track('view_change', { view });
      } catch {
        workspace({ view: '2d', activating: false });
        notify('Showing 2D: the 3D preview needs WebGL 2, which this browser does not support.');
      }
    },
    scene(patch: Partial<SceneSettings>, custom = false) {
      const previous = state.scene;
      const merged = { ...previous, ...patch, ...(custom ? { materialPreset: 'custom' } : {}) };
      const next =
        patch.gradientSource === 'location'
          ? applyLocationGradient(merged, state.source.terrain?.location)
          : merged;

      try {
        validateElevationGradient(next.gradient);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Invalid gradient.');

        return;
      }

      state = { ...state, scene: next };
      effects?.sceneChanged(previous);
      publish();
    },
    material(key: string) {
      const preset = (
        terrainMaterialPresets as Partial<
          Record<string, (typeof terrainMaterialPresets)[keyof typeof terrainMaterialPresets]>
        >
      )[key];

      if (preset) {
        controller.scene({
          materialPreset: key,
          surface: true,
          landFinish: preset.landFinish,
          surfaceMatch: false,
          surfaceColor: preset.land,
          waterFinish: preset.waterFinish,
          waterMatch: false,
          waterColor: preset.water,
          waterStyle: 'solid',
        });
      }
    },
    lighting(patch: Partial<TerrainLightingSettings>) {
      if (patch.timeOfDay !== undefined || patch.direction !== undefined) {
        controller.daylightCycle({ enabled: false });
      }

      controller.scene({
        lighting: { ...state.scene.lighting, ...patch },
        customLightDirection:
          patch.direction === undefined ? state.scene.customLightDirection : true,
      });
    },
    resetLighting() {
      controller.daylightCycle({ enabled: false });
      controller.scene({
        lighting: {
          ...defaultTerrainLighting,
          direction: getSuggestedTerrainLightDirection(state.source.terrain?.location?.latitude),
        },
        customLightDirection: false,
      });
    },
    camera(patch: Partial<TerrainCameraSettings>) {
      controller.scene({ camera: { ...state.scene.camera, ...patch } });
    },
    resetCameraSettings() {
      controller.scene({ camera: { ...defaultTerrainCameraSettings } });
    },
    applyViewPreset(preset: TerrainViewPreset) {
      const { projection } = terrainViewPresets[preset];

      if (projection) {
        controller.camera({ projection });
      }

      effects?.applyViewPreset(preset);
    },
    setCameraDirection(azimuth, elevation) {
      effects?.setCameraDirection(azimuth, elevation);
    },
    walkAt(clientX, clientY) {
      const hasStarted = effects?.walkAt(clientX, clientY) ?? false;

      if (hasStarted) {
        track('walk_start', {});
      }

      return hasStarted;
    },
    async pickFocus() {
      const pickId = ++latestFocusPickId;

      notify('Click the terrain to set focus. Press Escape to cancel.');
      const picked = (await effects?.pickFocus()) ?? false;

      // A newer pick superseded this one and owns the status message.
      if (pickId !== latestFocusPickId) {
        return;
      }

      if (picked) {
        controller.camera({ focusFollowsTarget: false });
      }

      notify(picked ? 'Focus set.' : 'Focus unchanged.');
    },
    model(patch: Partial<StudioState['model']>) {
      const merged = { ...state.model, ...patch };
      const next =
        patch.autoExaggeration === true
          ? applySuggestedExaggeration(merged, state.source.terrain)
          : merged;

      try {
        validateTerrainModelSettings(next.dimensions);

        if (!Number.isFinite(next.exaggeration) || next.exaggeration < 0 || next.exaggeration > 1) {
          throw new Error('Height exaggeration must be between 0 and 1.');
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Invalid model.');

        return false;
      }

      state = { ...state, model: next };
      // Rebuild first so the model redraw already shows the matching frame; the frame sync
      // passes the new dimensions to the view itself.
      rebuildFrame();
      effects?.modelChanged();
      publish();

      return true;
    },
    dimensions(patch: Partial<TerrainModelSettings>) {
      return controller.model({ dimensions: { ...state.model.dimensions, ...patch } });
    },
    frame(patch: Partial<FrameStudioSettings>) {
      state = {
        ...state,
        frame: { ...state.frame, settings: { ...state.frame.settings, ...patch } },
      };

      // Finish is preview colour only; the parts keep their shape.
      if (Object.keys(patch).every((key) => key === 'finish')) {
        effects?.frameChanged();
      } else {
        rebuildFrame();
      }

      publish();
    },
    downloadFrameStl(partId: FramePartId) {
      const part = findFramePart(partId);

      if (!part) {
        notify(`Frame part ${partId} is not available. Fix the frame settings and retry.`);

        return false;
      }

      try {
        effects?.downloadFrameStl(part);
        track('export', { format: 'frame_stl' });

        return true;
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Frame STL export failed.');

        return false;
      }
    },
    async downloadFrameStlParts(partIds: readonly FramePartId[]) {
      if (state.exportJobs.some(({ status }) => status === 'queued' || status === 'meshing')) {
        return;
      }

      const parts = partIds.flatMap((partId) => findFramePart(partId) ?? []);

      setExportJobs(
        parts.map((part) => ({
          id: part.id,
          label: `${part.id} STL`,
          status: 'queued',
          fraction: 0,
        })),
      );

      for (const part of parts) {
        updateExportJob(part.id, { status: 'meshing' });
        // Lets the list paint "meshing" before the synchronous STL build, and spaces the downloads.
        await new Promise((resolve) => setTimeout(resolve, exportJobPaceMs));

        try {
          effects?.downloadFrameStl(part);
          track('export', { format: 'frame_stl' });
          updateExportJob(part.id, {
            status: 'done',
            fraction: 1,
            sizeBytes: estimateBinaryStlBytes(part),
          });
        } catch (error) {
          updateExportJob(part.id, {
            status: 'failed',
            message: error instanceof Error ? error.message : 'Frame STL export failed.',
          });
        }
      }
    },
    metrics(height: number, layerHeight?: number) {
      if (state.metrics.height === height && state.metrics.layerHeight === layerHeight) {
        return;
      }

      state = { ...state, metrics: { ...state.metrics, height, layerHeight } };
      rebuildFrame();
      publish();
    },
    cameraPose(pose: CameraPose) {
      state = { ...state, cameraPose: pose };
      publish();
    },
    modelSpan(spanKm: number | undefined) {
      if (state.metrics.spanKm === spanKm) {
        return;
      }

      state = { ...state, metrics: { ...state.metrics, spanKm } };
      const roads = state.scene.roads;
      const suggestedWidthMm = getAutoRoadWidthMm(roads, spanKm);

      // Hidden roads pick up their width when enabled, so terrain loads never restyle them.
      if (roads.enabled && suggestedWidthMm !== undefined && suggestedWidthMm !== roads.widthMm) {
        controller.scene({ roads: { ...roads, widthMm: suggestedWidthMm } });
      } else {
        publish();
      }
    },
    async autoplay(patch) {
      const wasEnabled = state.source.autoplay.enabled;

      controller.source({ autoplay: { ...state.source.autoplay, ...patch } });
      clearTimeout(autoplayTimer);

      if (!state.source.autoplay.enabled) {
        return;
      }

      if (!wasEnabled && state.source.selected !== 'real') {
        await controller.useCoordinates();
      }

      const scheduleNextPlace = () => {
        clearTimeout(autoplayTimer);

        // Re-read after each load: the tour may have been switched off mid-download.
        if (!state.source.autoplay.enabled) {
          return;
        }

        autoplayTimer = setTimeout(() => {
          void showNextPlace();
        }, state.source.autoplay.delaySeconds * 1000);
      };

      const showNextPlace = async () => {
        if (state.source.loading) {
          scheduleNextPlace();

          return;
        }

        const next = getNextAutoplayPlace(state.source.place);

        controller.source({
          place: `${next.latitude},${next.longitude}`,
          latitude: next.latitude,
          longitude: next.longitude,
          spanKm: next.spanKm,
        });
        await controller.loadTerrain();

        scheduleNextPlace();
      };

      scheduleNextPlace();
    },
    daylightCycle(patch) {
      if (patch.enabled === true && isReducedMotionPreferred()) {
        notify('Daylight cycling is off while your system prefers reduced motion.');

        return;
      }

      controller.scene({ daylightCycle: { ...state.scene.daylightCycle, ...patch } });
      clearInterval(daylightTimer);
      daylightTimer = undefined;

      if (!state.scene.daylightCycle.enabled) {
        return;
      }

      let phase = getDaylightCyclePhase(state.scene.lighting.timeOfDay);
      let previousMs = Date.now();

      daylightTimer = setInterval(() => {
        const nowMs = Date.now();

        phase += (nowMs - previousMs) / 1000 / state.scene.daylightCycle.daySeconds;
        previousMs = nowMs;
        controller.scene({
          lighting: {
            ...state.scene.lighting,
            ...getDaylightCycleLighting(phase, state.source.terrain?.location?.latitude),
          },
        });
      }, daylightFrameMs);
    },
    source(patch: Partial<TerrainSourceState>) {
      state = { ...state, source: { ...state.source, ...patch } };
      publish();
    },
    useGenerated() {
      if (state.source.selected === 'generated') {
        return;
      }

      void controller.autoplay({ enabled: false });

      requestVersion++;
      terrainLoadCancel?.abort();

      if (state.source.terrain) {
        parked = { terrain: state.source.terrain, fieldsKey: loadedFieldsKey };
      }

      controller.source({
        selected: 'generated',
        loading: false,
        loadProgress: null,
        fault: null,
        status: 'Using generated terrain.',
      });
      applySource(undefined, true);
      track('terrain_load', { source: 'generated' });
    },
    async useCoordinates() {
      controller.selectSection('Terrain');

      // Coordinates with nothing loaded (a failed first load) retries rather than doing nothing.
      if (state.source.selected === 'real' && (state.source.terrain || state.source.loading)) {
        return;
      }

      // Location fields edited since the parked load ask for a fresh load, not a stale restore.
      if (parked?.fieldsKey !== getSourceFieldsKey(state.source)) {
        controller.source({ selected: 'real' });
        await controller.loadTerrain();

        return;
      }

      loadedFieldsKey = parked.fieldsKey;
      applySource(
        {
          ...parked.terrain,
          contourInterval: state.source.interval,
          seaLevelHatching: state.source.hatching,
        },
        true,
      );
      controller.source({ selected: 'real', status: 'Real terrain restored.' });
    },
    async loadTerrain() {
      const version = ++requestVersion;
      const source = state.source;
      const searchedPlace = pendingSearchedPlace;

      pendingSearchedPlace = undefined;

      terrainLoadCancel?.abort();
      const cancel = new AbortController();
      let latestProgress: TerrainLoadProgress | null = null;

      terrainLoadCancel = cancel;
      controller.source({
        loading: true,
        status: 'Downloading elevation tiles…',
        loadProgress: null,
        fault: null,
      });

      try {
        const terrain = await loadBrowserRealTerrain(
          source.latitude,
          source.longitude,
          source.spanKm,
          source.elevationFloor,
          source.maxDepth,
          {
            cancelSignal: cancel.signal,
            onProgress: (loaded, total) => {
              latestProgress = { loaded, total };

              if (version === requestVersion) {
                controller.source({ loadProgress: latestProgress });
              }
            },
          },
        );

        if (version !== requestVersion) {
          return;
        }

        loadedFieldsKey = getSourceFieldsKey(source);
        saveSearchedPlace(searchedPlace, source);
        applySource(
          {
            ...terrain,
            contourInterval: state.source.interval,
            seaLevelHatching: state.source.hatching,
          },
          true,
        );
        controller.source({
          selected: 'real',
          status: 'Real terrain loaded. Location is session-only.',
        });
        track('terrain_load', { source: 'real', span_km: source.spanKm });
      } catch (error) {
        if (version === requestVersion) {
          const fault = describeTerrainFault(error, latestProgress);

          controller.source({ status: fault.message, fault });
          track('terrain_load_failed', { fault: fault.code });
        }
      } finally {
        if (version === requestVersion) {
          controller.source({ loading: false, loadProgress: null });
        }
      }
    },
    cancelTerrainLoad() {
      if (!state.source.loading) {
        return;
      }

      requestVersion++;
      terrainLoadCancel?.abort();
      controller.source({
        loading: false,
        loadProgress: null,
        status: 'Terrain download cancelled.',
      });
    },
    dismissTerrainFault() {
      controller.source({ fault: null });
    },
    grass(patch: Partial<GrassStyle>) {
      const preset =
        patch.preset === undefined || patch.preset === 'custom'
          ? undefined
          : grassPresets[patch.preset];
      const editsLook = grassLookKeys.some((key) => key in patch);
      const look: Partial<GrassStyle> = preset
        ? Object.fromEntries(grassLookKeys.map((key) => [key, preset[key]]))
        : {};

      controller.scene({
        grass: {
          ...state.scene.grass,
          ...look,
          ...patch,
          // Hand-set look values override any preset in the same patch.
          ...(editsLook ? { preset: 'custom' as const } : {}),
        },
      });
    },
    roads(patch: Partial<RoadStyle>) {
      const wasEnabled = state.scene.roads.enabled;
      const merged = { ...state.scene.roads, ...patch };
      const suggestedWidthMm = getAutoRoadWidthMm(merged, state.metrics.spanKm);

      controller.scene({ roads: { ...merged, widthMm: suggestedWidthMm ?? merged.widthMm } });

      // Style edits never refetch, so dragging a slider after a failure cannot flood Overpass.
      if (merged.enabled && !wasEnabled) {
        void loadRoads();
      }
    },
    retryRoads() {
      if (state.scene.roads.enabled && state.roads.canRetry) {
        void loadRoads();
      }
    },
    searchPlaces(query) {
      return placeSearcher.search(query);
    },
    async loadSearchedPlace(match, spanKm) {
      void controller.autoplay({ enabled: false });
      pendingSearchedPlace = {
        name: match.name,
        region: match.detail,
        latitude: match.latitude,
        longitude: match.longitude,
      };
      controller.source({
        place: `${match.latitude},${match.longitude}`,
        latitude: match.latitude,
        longitude: match.longitude,
        ...(spanKm === undefined ? {} : { spanKm }),
      });
      await controller.loadTerrain();
    },
    interval(value: 'auto' | number) {
      try {
        validateRealContourInterval(value);
      } catch (error) {
        notify(error instanceof Error ? error.message : 'Invalid interval.');

        return false;
      }

      controller.source({ interval: value, ...(value === 'auto' ? {} : { fixedInterval: value }) });

      if (state.source.terrain) {
        applySource({ ...state.source.terrain, contourInterval: value }, false);
      }

      return true;
    },
    hatching(value: boolean) {
      controller.source({ hatching: value });

      if (state.source.terrain) {
        applySource({ ...state.source.terrain, seaLevelHatching: value }, false);
      }
    },
    resetCamera() {
      effects?.resetCamera();
    },
    saveCameraShot() {
      const captured = effects?.captureCameraShot() ?? 'not-3d';

      if (typeof captured === 'string') {
        notify(cameraShotBlockerMessages[captured]);

        return;
      }

      const shots = [
        ...state.cameraShots.shots,
        { ...captured.shot, id: nextCameraShotId++, thumbnailUrl: captured.thumbnailUrl },
      ];

      notify(`Shot ${shots.length} saved`);
      // After the notice, so a tour that cannot restart reports why instead.
      replaceCameraShots(shots);
    },
    removeCameraShot(id) {
      replaceCameraShots(state.cameraShots.shots.filter((shot) => shot.id !== id));
    },
    clearCameraShots() {
      effects?.stopCameraShots();
      setCameraShots({ shots: [], isPlaying: false });
      notify('Shots cleared');
    },
    flyToCameraShot(id) {
      const shot = state.cameraShots.shots.find((candidate) => candidate.id === id);

      const blocker = shot && effects?.flyToCameraShot(shot);

      if (blocker) {
        notify(cameraShotBlockerMessages[blocker]);
      }
    },
    toggleCameraShotPlayback() {
      const { shots, isPlaying } = state.cameraShots;

      if (isPlaying) {
        effects?.stopCameraShots();

        return;
      }

      if (shots.length === 0) {
        notify('Press B to save a shot first');

        return;
      }

      const blocker = playCameraShotTour(shots);

      if (blocker) {
        notify(cameraShotBlockerMessages[blocker]);

        return;
      }

      track('camera_tour_play', { shots: shots.length });
      notify(`Playing ${shots.length} ${shots.length === 1 ? 'shot' : 'shots'}`);
    },
    stopCameraShots() {
      effects?.stopCameraShots();
    },
    downloadStl() {
      try {
        effects?.downloadStl();
        track('export', { format: 'stl' });

        return true;
      } catch (error) {
        notify(error instanceof Error ? error.message : 'STL export failed.');

        return false;
      }
    },
    async downloadStill(scale: TerrainStillScale) {
      try {
        const size = await effects?.downloadStill(scale);

        if (size) {
          track('export', { format: 'still' });
          notify(`Saved a ${size.width} × ${size.height} px 3D still.`);
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : '3D still export failed.');
      }
    },
  };

  return controller;
}

/** Identifies the location fields a real-terrain load used; must list every input `loadTerrain` passes on. */
function getSourceFieldsKey(source: TerrainSourceState): string {
  return JSON.stringify([
    source.latitude,
    source.longitude,
    source.spanKm,
    source.elevationFloor,
    source.maxDepth,
  ]);
}

/** The width auto mode asks for, or undefined while the user's own width applies. */
function getAutoRoadWidthMm(style: RoadStyle, modelSpanKm: number | undefined): number | undefined {
  return style.autoWidth && modelSpanKm !== undefined
    ? getSuggestedRoadWidthMm(modelSpanKm)
    : undefined;
}

/** Settings a grass preset owns; editing any of them by hand makes the look custom. */
const grassLookKeys = [
  'baseColor',
  'tipColor',
  'dryColor',
  'colorVariation',
  'dryness',
  'lengthMm',
  'lengthVariation',
] as const satisfies readonly (keyof GrassStyle)[];

/** Real terrain with a location and span can carry roads; generated terrain cannot. */
function getRoadPlacement(
  terrain: RealTerrain | undefined,
): Required<Pick<RealTerrain, 'location' | 'spanKm'>> | undefined {
  return terrain?.location && terrain.spanKm !== undefined
    ? { location: terrain.location, spanKm: terrain.spanKm }
    : undefined;
}

/** True when road ribbons are on screen, so their source needs crediting. */
export function areRoadsDrawn(state: StudioState): boolean {
  return (
    state.workspace.view === '3d' &&
    state.scene.roads.enabled &&
    state.roads.network !== undefined &&
    state.model.dimensions.terrainShape !== 'terraced'
  );
}

/** Terrain and drawn-road credits for a 3D still, one source per line. */
export function getSceneCredits(
  state: StudioState,
  terrainAttribution: string | undefined,
): string[] {
  const roadAttribution = areRoadsDrawn(state) ? state.roads.network?.attribution : undefined;

  return [terrainAttribution, roadAttribution].filter(
    (credit): credit is string => credit !== undefined && credit !== '',
  );
}

/** Counts what the current detail draws and says what was left out. */
export function describeRoadNetwork(network: RoadNetwork, style: RoadStyle): string {
  const classes: readonly string[] = roadDetailClasses[style.detail];
  const drawn = network.roads.filter((road) => classes.includes(road.roadClass)).length;
  // Only omissions within the drawn classes; a hidden track bridge is irrelevant to major roads.
  const hidden = network.omitted.filter((omission) => classes.includes(omission.roadClass));
  const bridges = hidden.filter((omission) => omission.kind === 'bridge').length;
  const parts = [countOf(drawn, 'mapped road')];

  if (hidden.length > 0) {
    parts.push(
      `${countOf(bridges, 'bridge')} and ${countOf(hidden.length - bridges, 'tunnel')} hidden`,
    );
  }

  if (network.detail === 'major' && style.detail !== 'major') {
    parts.push(`minor roads need an area of ${roadSpanLimitsKm.allRoads} km or less`);
  }

  return `${parts.join(' · ')}.`;
}

/** Sections the inspector leaves out in this state: 3D-only ones in 2D, Route without real terrain. */
export function getHiddenSections(
  state: Pick<StudioState, 'workspace' | 'source'>,
): InspectorSection[] {
  return [
    ...(state.workspace.view === '3d' ? [] : threeDOnlySections),
    ...(state.source.terrain === undefined ? (['Route'] as const) : []),
  ];
}

/** The open section, or Terrain when the remembered one is hidden (e.g. Route after real terrain goes). */
export function getActiveSection(
  state: Pick<StudioState, 'workspace' | 'source'>,
): InspectorSection {
  const remembered = state.workspace.sections[state.workspace.view];

  return getHiddenSections(state).includes(remembered) ? 'Terrain' : remembered;
}

// Stats come from recorded points: recomputed only when those change (a reversal swaps ascent and
// descent), reused while scrubbing, and gone once an edit makes the route a drawn one. A stale
// profile cursor is dropped too.
function toWorkspaceRoute(
  active: ActiveRoute,
  editing: RouteEditing,
  isVisible: boolean,
  previous: WorkspaceRoute | null,
  inspectedDistanceMeters?: number,
): WorkspaceRoute {
  const { originalPoints } = active;
  const stats =
    originalPoints === undefined
      ? undefined
      : previous?.active.originalPoints === originalPoints
        ? previous.stats
        : routeStats(originalPoints);

  return {
    active,
    editing,
    isVisible,
    ...(inspectedDistanceMeters === undefined ? {} : { inspectedDistanceMeters }),
    ...(stats === undefined ? {} : { stats }),
  };
}

function toGeoPoint({ latitude, longitude }: GeoPoint): GeoPoint {
  return { latitude, longitude };
}

/** FNV-1a over name and coordinates: the same file always gets the same id, with no randomness. */
function createRouteId(name: string, points: readonly GeoPoint[]): string {
  let hash = 0x811c9dc5;

  const text = `${name}|${points.map((p) => `${p.latitude},${p.longitude}`).join(';')}`;

  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }

  return `imported-${hash.toString(16).padStart(8, '0')}`;
}

/** "1 bridge", "2 bridges", "1,204 mapped roads". */
function countOf(count: number, noun: string): string {
  return `${count.toLocaleString('en')} ${noun}${count === 1 ? '' : 's'}`;
}

/** Unknown places (typed coordinates, generated terrain) keep the current gradient. */
function applyLocationGradient(
  scene: SceneSettings,
  location: { latitude: number; longitude: number } | undefined,
): SceneSettings {
  const preset = realTerrainPresets.find(
    (place) => place.latitude === location?.latitude && place.longitude === location.longitude,
  );

  if (!preset) {
    return scene;
  }

  const key = getLandscapeGradientKey(preset.landscape);

  return {
    ...scene,
    gradient: copyElevationGradient({
      ...scene.gradient,
      stops: landscapeGradientPresets[key].stops,
    }),
    gradientPreset: key,
  };
}

/** Follows the grouped menu order so autoplay matches what the location select shows. */
function getNextAutoplayPlace(place: string): (typeof realTerrainPresets)[number] {
  const places = realTerrainPresetGroups.flatMap((group) => group.locations);
  const index = places.findIndex(
    (candidate) => `${candidate.latitude},${candidate.longitude}` === place,
  );

  return places[(index + 1) % places.length];
}

/** Generated terrain has no real scale, so it keeps the current height. */
function applySuggestedExaggeration(
  model: StudioState['model'],
  terrain: RealTerrain | undefined,
): StudioState['model'] {
  const elevations = terrain?.elevations;

  if (!elevations || terrain.spanKm === undefined) {
    return model;
  }

  // The model spans 1.6 units of metersPerUnit, so this is the relief the model shows.
  return {
    ...model,
    exaggeration: getSuggestedExaggeration(elevations.metersPerUnit * 1.6, terrain.spanKm),
  };
}

/** Parses a stored design link exactly as a pasted URL would be; null when it is not a valid link. */
function readDesignLink(link: string): Partial<DesignSettings> | null {
  try {
    const result = parseDesignParameters(new URL(link).searchParams);

    return result.ok ? result.data.settings : null;
  } catch {
    return null;
  }
}

/** Absent outside browsers, where tests run with motion allowed. */
function isReducedMotionPreferred(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
