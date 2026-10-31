/** Route actions shared by the Route group and the command palette. */
import { track } from '../analytics';
import { downloadExport } from '../export/image-export';
import { getRouteGpxFilename, serializeRouteGpx } from '../gpx-export';
import { isRouteComplete } from './route-editing';
import type { StudioController, StudioState } from './controller';

// === PUBLIC API ===

/** Starts a drawn route and hands the canvas to the Route tool; a non-empty route asks first. */
export function drawRoute(controller: StudioController): void {
  if (!controller.startRouteDrawing().needsConfirmation) {
    controller.workspace({ toolMode: 'route' });
  }
}

/** Downloads the route as GPX with terrain elevations for drawn points; failures reach the status line. */
export function exportRouteGpx(controller: StudioController, state: StudioState): void {
  const { route } = state.workspace;

  if (route === null || !isRouteComplete(route.active)) {
    controller.notify('Draw at least two waypoints before exporting the route.');

    return;
  }

  const sampler = state.source.terrain?.sourceElevations;

  try {
    const xml = serializeRouteGpx(route.active, (point) => sampler?.sampleMeters(point));
    const downloaded = downloadExport({
      blob: new Blob([xml], { type: 'application/gpx+xml' }),
      filename: getRouteGpxFilename(route.active),
    });

    if (downloaded.ok) {
      track('route_export', {});
    }

    controller.notify(downloaded.ok ? 'GPX download started.' : downloaded.error.message);
  } catch (failure) {
    controller.notify(
      failure instanceof Error ? `GPX export failed: ${failure.message}` : 'GPX export failed.',
    );
  }
}
