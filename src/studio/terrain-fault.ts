import { getFault, type FaultCode } from '../constants/faults';
import { TerrainLoadError } from '../terrain-load-error';

/** A failure to show in a FaultCard; `message` is the full, actionable explanation. */
export interface StudioFault {
  code: FaultCode;
  title: string;
  isRetryable: boolean;
  message: string;
  /** Short measure of the damage such as '3 of 9 tiles'. */
  metric?: string;
}

export interface TerrainLoadProgress {
  loaded: number;
  total: number;
}

/** Maps a failed terrain load to its E-2xx fault; unclassified failures count as downloads. */
export function describeTerrainFault(
  error: unknown,
  progress: TerrainLoadProgress | null,
): StudioFault {
  const kind = error instanceof TerrainLoadError ? error.kind : 'tileDownloadFailed';
  const message = error instanceof Error ? error.message : 'Terrain could not load. Please retry.';
  const metric =
    kind !== 'locationOutOfRange' && progress !== null && progress.total > 0
      ? `${progress.loaded} of ${progress.total} tiles`
      : undefined;

  return { ...getFault(kind), message, ...(metric === undefined ? {} : { metric }) };
}
