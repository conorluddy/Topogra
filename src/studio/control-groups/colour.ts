/*
 * Colour section (COLR.01 to COLR.06): palette presets and canvas colour, then in 3D the material,
 * land, elevation gradient and water groups, and finally the style reset.
 * Row ids are the original field ids the e2e tests bind to. The pattern is in ./README.md.
 */
import { createElement } from 'react';
import { designPalettePresets } from '../../constants/palettes';
import { resetDesignStyle } from '../../design-settings';
import { createRandomPalette } from '../../random-palette';
import {
  elevationGradientPresets,
  landscapeGradientPresets,
  type ElevationColorStop,
} from '../../terrain-elevation-gradient';
import { landFinishes, terrainMaterialPresets, waterFinishes } from '../../terrain-materials';
import { getTerrainWaterColor } from '../../terrain-water';
import type { DesignSettings } from '../../types/design';
import type { ControlGroupDefinition } from '../../ui/control-rows';
import type { StudioController, StudioState } from '../controller';
import {
  buttonRow,
  colourRow,
  customRow,
  hintRow,
  selectRow,
  tilesRow,
  toggleRow,
} from '../control-rows';
import { GradientEditor } from '../gradient-editor';

type PaletteName = keyof typeof designPalettePresets;

// === PUBLIC API ===

export function buildColourGroups(
  controller: StudioController,
  state: StudioState,
): ControlGroupDefinition[] {
  return [
    buildPaletteGroup(controller, state),
    ...(state.workspace.view === '3d'
      ? [
          buildWorkspaceGroup(controller, state),
          buildMaterialsGroup(controller, state),
          buildLandGroup(controller, state),
          buildElevationGradientGroup(controller, state),
          buildWaterMaterialGroup(controller, state),
        ]
      : []),
    buildStyleResetGroup(controller, state),
  ];
}

// === GROUPS ===

function buildPaletteGroup(
  controller: StudioController,
  state: StudioState,
): ControlGroupDefinition {
  const paletteNames = Object.keys(designPalettePresets) as PaletteName[];

  return {
    id: 'palette',
    title: 'Palette',
    isPinnable: true,
    rows: [
      tilesRow<PaletteName>('palette-presets', {
        label: 'Palette presets',
        // Pressed state spans several settings, so `isPressedComputed` decides; `value` only seeds the tab stop.
        value: paletteNames.find((name) => isPaletteApplied(state, name)) ?? paletteNames[0],
        options: paletteNames.map((name) => ({
          value: name,
          label: name,
          swatchColor: designPalettePresets[name].background,
          swatchBorderColor: designPalettePresets[name].lineColor,
        })),
        isPressedComputed: (option) => isPaletteApplied(state, option.value),
        onChange: (name) => {
          controller.applyPalettePreset(name);
        },
      }),
      buttonRow('palette-random', {
        children: 'Random',
        onClick: () => {
          controller.design(createRandomPalette());
        },
      }),
      colourRow('background', {
        label: 'Canvas color',
        value: state.design.background,
        onChange: (background) => {
          controller.design({ background });
        },
      }),
      hintRow(
        'palette-hint',
        'Palette presets change both canvas and contour colours. Edit individual contour colour in Contours.',
      ),
    ],
  };
}

function buildWorkspaceGroup(
  controller: StudioController,
  state: StudioState,
): ControlGroupDefinition {
  return {
    id: 'workspace',
    title: 'Workspace',
    isPinnable: true,
    rows: [
      tilesRow<'dark' | 'light'>('workspace-colour', {
        label: 'Workspace',
        value: state.scene.groundColor === '#202326' ? 'dark' : 'light',
        options: [
          { value: 'dark', label: 'Dark', swatchColor: '#202326' },
          { value: 'light', label: 'Light', swatchColor: '#b4b4b4' },
        ],
        onChange: (value) => {
          controller.scene({
            ground: true,
            groundMatch: false,
            groundColor: value === 'dark' ? '#202326' : '#b4b4b4',
          });
        },
      }),
    ],
  };
}

function buildMaterialsGroup(
  controller: StudioController,
  state: StudioState,
): ControlGroupDefinition {
  return {
    id: 'materials',
    title: 'Materials',
    isPinnable: true,
    rows: [
      selectRow('material-preset', {
        label: 'Material preset',
        value: state.scene.materialPreset,
        options: [{ value: 'custom', label: 'Custom' }, ...namedOptions(terrainMaterialPresets)],
        onChange: (key) => {
          controller.material(key);
        },
      }),
    ],
  };
}

function buildLandGroup(controller: StudioController, state: StudioState): ControlGroupDefinition {
  const { scene } = state;
  const isNatural = scene.landFinish === 'natural';

  return {
    id: 'land',
    title: 'Land',
    isPinnable: true,
    rows: [
      selectRow('land-finish', {
        label: 'Land finish',
        value: scene.landFinish,
        options: namedOptions(landFinishes),
        onChange: (landFinish) => {
          controller.scene({ landFinish: landFinish as typeof scene.landFinish }, true);
        },
      }),
      !scene.gradient.enabled &&
        toggleRow('land-surface-match', {
          label: isNatural ? 'Use natural palette' : 'Match background',
          value: scene.surfaceMatch,
          onChange: (surfaceMatch) => {
            controller.scene({ surfaceMatch }, true);
          },
        }),
      !scene.gradient.enabled &&
        colourRow('land-surface-color', {
          label: isNatural ? 'Surface tint' : 'Surface color',
          value: scene.surfaceMatch
            ? isNatural
              ? '#ffffff'
              : state.design.background
            : scene.surfaceColor,
          disabled: scene.surfaceMatch,
          onChange: (surfaceColor) => {
            controller.scene({ surfaceColor }, true);
          },
        }),
      hintRow(
        'land-hint',
        'Natural blends moss, soil and rock. White tint preserves the original colours.',
      ),
    ],
  };
}

function buildElevationGradientGroup(
  controller: StudioController,
  state: StudioState,
): ControlGroupDefinition {
  const { scene } = state;
  const { gradient } = scene;

  return {
    id: 'elevation-gradient',
    title: 'Elevation gradient',
    isPinnable: true,
    rows: [
      toggleRow('gradient-enabled', {
        label: 'Color by elevation',
        value: gradient.enabled,
        onChange: (enabled) => {
          controller.scene({ gradient: { ...gradient, enabled } });
        },
      }),
      ...(gradient.enabled
        ? [
            selectRow('gradient-preset', {
              label: 'Gradient preset',
              value: scene.gradientSource === 'location' ? 'location' : scene.gradientPreset,
              options: [
                { value: 'location', label: 'Match location' },
                { value: 'custom', label: 'Custom' },
                { group: 'Studio', options: namedOptions(elevationGradientPresets) },
                { group: 'Landscapes', options: namedOptions(landscapeGradientPresets) },
              ],
              onChange: (key) => {
                selectGradientPreset(controller, state, key);
              },
            }),
            selectRow('gradient-transition', {
              label: 'Transitions',
              value: gradient.transition,
              options: ['soft', 'hard'],
              onChange: (transition) => {
                controller.scene({ gradient: { ...gradient, transition } });
              },
            }),
            customRow('gradient-editor', () =>
              createElement(GradientEditor, {
                gradient,
                // Any manual edit detaches the gradient from its preset and from the location.
                onUpdate: (patch) => {
                  controller.scene({
                    gradient: { ...gradient, ...patch },
                    gradientPreset: 'custom',
                    gradientSource: 'user',
                  });
                },
              }),
            ),
            hintRow(
              'gradient-hint',
              'Colors stay anchored to the landscape when cropping. Land finish controls texture and sheen.',
            ),
          ]
        : []),
    ],
  };
}

function buildWaterMaterialGroup(
  controller: StudioController,
  state: StudioState,
): ControlGroupDefinition {
  const { scene } = state;

  return {
    id: 'water-material',
    title: 'Water material',
    isPinnable: true,
    rows: [
      selectRow('water-finish', {
        label: 'Water finish',
        value: scene.waterFinish,
        options: namedOptions(waterFinishes),
        onChange: (waterFinish) => {
          controller.scene({ waterFinish: waterFinish as typeof scene.waterFinish }, true);
        },
      }),
      toggleRow('water-match', {
        label: 'Match terrain',
        value: scene.waterMatch,
        onChange: (waterMatch) => {
          controller.scene({ waterMatch }, true);
        },
      }),
      colourRow('water-color', {
        label: 'Water color',
        value: scene.waterMatch
          ? getTerrainWaterColor(scene.surfaceMatch ? state.design.background : scene.surfaceColor)
          : scene.waterColor,
        disabled: scene.waterMatch,
        onChange: (waterColor) => {
          controller.scene({ waterColor }, true);
        },
      }),
    ],
  };
}

function buildStyleResetGroup(
  controller: StudioController,
  state: StudioState,
): ControlGroupDefinition {
  return {
    id: 'style-reset',
    title: 'Style reset',
    rows: [
      buttonRow('style-reset-button', {
        children: 'Reset design style',
        onClick: () => {
          controller.design(resetDesignStyle(state.design));
        },
      }),
      hintRow(
        'style-reset-hint',
        'Resets shared design and interaction settings; preserves the seed, output options and 3D setup.',
      ),
    ],
  };
}

// === HELPERS ===

/** A preset is pressed while every setting it carries matches the current design. */
function isPaletteApplied(state: StudioState, name: PaletteName): boolean {
  return Object.entries(designPalettePresets[name]).every(
    ([key, value]) => state.design[key as keyof DesignSettings] === value,
  );
}

function selectGradientPreset(controller: StudioController, state: StudioState, key: string): void {
  if (key === 'location') {
    controller.scene({ gradientSource: 'location' });

    return;
  }

  const preset = (
    {
      ...elevationGradientPresets,
      ...landscapeGradientPresets,
    } as Partial<Record<string, { stops: readonly ElevationColorStop[] }>>
  )[key];

  if (preset) {
    controller.scene({
      gradient: { ...state.scene.gradient, stops: preset.stops.map((stop) => ({ ...stop })) },
      gradientPreset: key,
      gradientSource: 'user',
    });
  }
}

function namedOptions(
  values: Record<string, { label: string }>,
): { value: string; label: string }[] {
  return Object.entries(values).map(([value, { label }]) => ({ value, label }));
}
