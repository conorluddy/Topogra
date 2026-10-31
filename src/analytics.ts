/** Typed Google Analytics events for the hosted site; every call is a no-op until a visitor allows analytics. */

import type { PalettePresetName } from './constants/palettes';
import type { FaultCode, OperationErrorCode } from './constants/faults';

type NoParameters = Record<string, never>;

/** Every event the app reports. Parameters are enums and counts only: never locations, seeds, names or route data. */
export interface AnalyticsEvents {
  export: { format: 'svg' | 'png' | 'stl' | 'frame_stl' | 'still' };
  share_link: { ok: boolean };
  terrain_load: { source: 'real' | 'generated'; span_km?: number };
  terrain_load_failed: { fault: FaultCode };
  view_change: { view: '2d' | '3d' };
  preset_apply: { name: PalettePresetName };
  route_import: NoParameters;
  route_export: NoParameters;
  walk_start: NoParameters;
  camera_tour_play: { shots: number };
  design_save: NoParameters;
  operation_failed: { code: OperationErrorCode; retryable: boolean };
}

type GtagFunction = (command: 'event', name: string, parameters: object) => void;

// === PUBLIC API ===

/** Reports one event. `loadAnalytics` defines `gtag` only after consent on the hosted site, so everything else stays silent. */
export function track<Name extends keyof AnalyticsEvents>(
  name: Name,
  parameters: AnalyticsEvents[Name],
  gtag: GtagFunction | undefined = (globalThis as { gtag?: GtagFunction }).gtag,
): void {
  try {
    gtag?.('event', name, parameters);
  } catch {
    // Analytics must never break the editor.
  }
}
