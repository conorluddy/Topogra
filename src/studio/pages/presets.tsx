import type { ReactNode } from 'react';
import { designPalettePresets } from '../../constants/palettes';
import { ListRow } from '../../ui/list-row';
import { PresetCard, PresetStrip } from '../../ui/preset-card';
import { SettingsGroup } from '../../ui/settings-group';
import type { StudioController, StudioState } from '../controller';

type PaletteName = keyof typeof designPalettePresets;

const paletteNames = Object.keys(designPalettePresets) as PaletteName[];

/** Presets page: the palette presets as a swatch strip and a list. Applying one is `controller.design(preset)`. */
export function PresetsPage({
  controller: c,
  state,
  isActive,
}: {
  controller: StudioController;
  state: StudioState;
  isActive: boolean;
}): ReactNode {
  const isApplied = (name: PaletteName): boolean =>
    designPalettePresets[name].background === state.design.background &&
    designPalettePresets[name].lineColor === state.design.lineColor;

  const apply = (name: PaletteName): void => {
    c.applyPalettePreset(name);
  };

  return (
    <section className="studio-page" aria-label="Presets" hidden={!isActive}>
      <header className="studio-page__header">
        <h1 className="studio-page__title">Presets</h1>
      </header>
      <PresetStrip label="Palettes">
        {paletteNames.map((name) => (
          <PresetCard
            key={name}
            name={name}
            swatches={[designPalettePresets[name].background, designPalettePresets[name].lineColor]}
            isActive={isApplied(name)}
            onSelect={() => {
              apply(name);
            }}
          />
        ))}
      </PresetStrip>
      <SettingsGroup title="Palette presets" code="PRE.01">
        {paletteNames.map((name) => (
          <ListRow
            key={name}
            title={`${name} palette`}
            detail={`${designPalettePresets[name].background} · ${designPalettePresets[name].lineColor}`}
            meta={isApplied(name) ? 'Applied' : undefined}
            leading="◧"
            onClick={() => {
              apply(name);
            }}
          />
        ))}
      </SettingsGroup>
    </section>
  );
}
