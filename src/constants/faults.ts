/*
 * E-NNN fault taxonomy: a display layer over `operationErrorCodes` and the studio-only failures
 * that never travel as an OperationError. Ranges (OQ-1 in #96, an assumption to confirm):
 *
 *   E-1xx storage and settings   E-2xx terrain and map data
 *   E-3xx WebGL and render       E-4xx export
 *
 * | Code  | Key                  | Title                  | Retryable |
 * | ----- | -------------------- | ---------------------- | --------- |
 * | E-101 | INVALID_SETTINGS     | Invalid design         | no        |
 * | E-102 | UNSUPPORTED_VERSION  | Unsupported link       | no        |
 * | E-103 | STORAGE_FAILED       | Storage unavailable    | yes       |
 * | E-104 | URL_FAILED           | Design link failed     | yes       |
 * | E-105 | CLIPBOARD_FAILED     | Clipboard blocked      | yes       |
 * | E-201 | tileDownloadFailed   | Tile download failed   | yes       |
 * | E-202 | MAP_DATA_FAILED      | Map data unavailable   | yes       |
 * | E-203 | PLACE_SEARCH_FAILED  | Place search failed    | yes       |
 * | E-204 | tileDecodeFailed     | Tile decode failed     | yes       |
 * | E-205 | locationOutOfRange   | Location out of range  | no        |
 * | E-206 | INVALID_ROUTE        | Route file invalid     | no        |
 * | E-301 | webglUnavailable     | WebGL unavailable      | no        |
 * | E-302 | webglContextLost     | WebGL context lost     | yes       |
 * | E-303 | previewDecodeFailed  | Preview decode failed  | yes       |
 * | E-304 | MODULE_LOAD_FAILED   | Module load failed     | yes       |
 * | E-401 | EXPORT_FAILED        | Export failed          | yes       |
 */
import { operationErrorCodes } from './operations';

export type OperationErrorCode = (typeof operationErrorCodes)[keyof typeof operationErrorCodes];

/** Failures the studio reports that have no OperationError of their own. */
export type StudioFaultKind =
  | 'tileDownloadFailed'
  | 'tileDecodeFailed'
  | 'locationOutOfRange'
  | 'webglUnavailable'
  | 'webglContextLost'
  | 'previewDecodeFailed';

/** A fault's display code, e.g. `E-201`. */
export type FaultCode = `E-${number}`;

export interface FaultDescription {
  code: FaultCode;
  title: string;
  isRetryable: boolean;
}

export const faultCodes: Readonly<Record<OperationErrorCode | StudioFaultKind, FaultDescription>> =
  {
    [operationErrorCodes.invalidSettings]: describe('E-101', 'Invalid design', false),
    [operationErrorCodes.unsupportedVersion]: describe('E-102', 'Unsupported link', false),
    [operationErrorCodes.storageFailed]: describe('E-103', 'Storage unavailable', true),
    [operationErrorCodes.urlFailed]: describe('E-104', 'Design link failed', true),
    [operationErrorCodes.clipboardFailed]: describe('E-105', 'Clipboard blocked', true),
    tileDownloadFailed: describe('E-201', 'Tile download failed', true),
    [operationErrorCodes.mapDataFailed]: describe('E-202', 'Map data unavailable', true),
    [operationErrorCodes.placeSearchFailed]: describe('E-203', 'Place search failed', true),
    tileDecodeFailed: describe('E-204', 'Tile decode failed', true),
    locationOutOfRange: describe('E-205', 'Location out of range', false),
    [operationErrorCodes.invalidRoute]: describe('E-206', 'Route file invalid', false),
    webglUnavailable: describe('E-301', 'WebGL unavailable', false),
    webglContextLost: describe('E-302', 'WebGL context lost', true),
    previewDecodeFailed: describe('E-303', 'Preview decode failed', true),
    [operationErrorCodes.moduleLoadFailed]: describe('E-304', 'Module load failed', true),
    [operationErrorCodes.exportFailed]: describe('E-401', 'Export failed', true),
  };

/** Resolves an operation code or studio failure to its E-NNN code, title and default retryability. */
export function getFault(kind: OperationErrorCode | StudioFaultKind): FaultDescription {
  return faultCodes[kind];
}

function describe(code: FaultCode, title: string, isRetryable: boolean): FaultDescription {
  return { code, title, isRetryable };
}
