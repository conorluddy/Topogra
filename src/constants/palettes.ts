import { versionOneDesignDefaults } from './design';
import type { DesignSettings } from '../types/design';

/** Named appearance presets shared by the browser controls and CLI. */
export const designPalettePresets = {
  Charcoal: {
    background: versionOneDesignDefaults.background,
    lineColor: versionOneDesignDefaults.lineColor,
    strokeOpacity: versionOneDesignDefaults.strokeOpacity,
    strokeWidth: versionOneDesignDefaults.strokeWidth,
    indexStrokeWidth: versionOneDesignDefaults.indexStrokeWidth,
  },
  Paper: {
    background: '#eee9dd',
    lineColor: '#716c5e',
    strokeOpacity: 0.45,
    strokeWidth: 0.8,
    indexStrokeWidth: 1.2,
  },
  Blueprint: {
    background: '#153c68',
    lineColor: '#b9dbf5',
    strokeOpacity: 0.55,
    strokeWidth: 0.8,
    indexStrokeWidth: 1.3,
  },
  Bold: {
    background: '#151816',
    lineColor: '#c2dc8a',
    strokeOpacity: 0.8,
    strokeWidth: 1.5,
    indexStrokeWidth: 2.4,
  },
} as const satisfies Record<string, Partial<DesignSettings>>;

export type PalettePresetName = keyof typeof designPalettePresets;
