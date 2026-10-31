import { useEffect, useState, type ReactNode } from 'react';
import { track } from '../../analytics';
import { getDesignUrl } from '../../design-settings';
import {
  addSavedDesign,
  readSavedDesigns,
  removeSavedDesign,
  writeSavedDesigns,
  type SavedDesign,
  toSavedRoute,
  type SavedTerrain,
} from '../../saved-designs';
import type { OutputRenderer } from '../../types/export';
import { Button } from '../../ui/button';
import { EmptyState } from '../../ui/empty-state';
import { ModelCard } from '../../ui/model-card';
import { StatusMessage } from '../../ui/status-message';
import { Tag } from '../../ui/tag';
import { browserLocalStorage, type BrowserStorage } from '../browser-storage';
import type { StudioController, StudioState } from '../controller';
import { describeTarget } from '../hud-readouts';
import { createDesignThumbnailSvg } from './library-thumbnail';

interface Notice {
  kind: 'ok' | 'fault';
  text: string;
}

/**
 * Library page: designs saved in this browser (`src/saved-designs.ts`). "Save current" stores the
 * design link and a thumbnail; opening a card restores the link through the same parser as a URL.
 */
export function LibraryPage({
  controller: c,
  state,
  renderer,
  isActive,
  storage = browserLocalStorage,
}: {
  controller: StudioController;
  state: StudioState;
  renderer: OutputRenderer;
  isActive: boolean;
  storage?: BrowserStorage;
}): ReactNode {
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Re-read on every visit: Account > Clear local storage can empty the Library while it is hidden.
  useEffect(() => {
    if (!isActive) {
      return;
    }

    const result = readSavedDesigns(storage);

    setDesigns(result.ok ? result.data : []);
    setNotice(result.ok ? null : { kind: 'fault', text: result.error.message });
  }, [isActive, storage]);

  const persist = (next: SavedDesign[], successText?: string): boolean => {
    const result = writeSavedDesigns(storage, next);

    setDesigns(next);
    setNotice(
      result.ok
        ? successText === undefined
          ? null
          : { kind: 'ok', text: successText }
        : { kind: 'fault', text: result.error.message },
    );

    return result.ok;
  };

  const saveCurrent = (): void => {
    const saved = createSavedDesign(state, renderer);

    if (persist(addSavedDesign(designs, saved), `Saved ${saved.name}.`)) {
      track('design_save', {});
    }
  };

  const open = (design: SavedDesign): void => {
    void c.restoreSavedDesign(design).then((result) => {
      if (!result.ok) {
        setNotice({ kind: 'fault', text: result.error.message });

        return;
      }

      c.workspace({ page: 'studio' });
    });
  };

  return (
    <section className="studio-page" aria-label="Library" hidden={!isActive}>
      <header className="studio-page__header">
        <h1 className="studio-page__title">Library</h1>
        <Button variant="primary" size="large" onClick={saveCurrent}>
          Save current
        </Button>
      </header>
      {notice !== null && (
        <StatusMessage kind={notice.kind} isAlert={notice.kind === 'fault'}>
          {notice.text}
        </StatusMessage>
      )}
      {designs.length === 0 ? (
        <EmptyState glyph="▦" title="No saved designs">
          Save the current landscape to keep it here.
        </EmptyState>
      ) : (
        <div className="studio-page__grid">
          {designs.map((design) => (
            <ModelCard
              key={design.id}
              title={design.name}
              subtitle={describeSavedDesign(design)}
              thumbnail={<DesignThumbnail svg={design.thumbnailSvg} />}
              tags={
                <Tag variant={design.source === 'real' ? 'outlineBone' : 'outlineMuted'}>
                  {design.source === 'real' ? 'Real' : 'Procedural'}
                </Tag>
              }
              onOpen={() => {
                open(design);
              }}
              onDelete={() => {
                persist(removeSavedDesign(designs, design.id));
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// === HELPERS ===

function DesignThumbnail({ svg }: { svg: string | null }): ReactNode {
  if (svg === null) {
    return <span aria-hidden="true">≋</span>;
  }

  return <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} />;
}

function createSavedDesign(state: StudioState, renderer: OutputRenderer): SavedDesign {
  const isReal = state.source.terrain !== undefined;
  const placeName = describeTarget(state, undefined).title;
  const now = new Date();
  const route = state.workspace.route?.active;

  return {
    id: `${now.getTime().toString(36)}-${state.design.seed.toString(36)}`,
    name: isReal ? placeName : `Seed ${String(state.design.seed)}`,
    savedAt: now.toISOString(),
    link: getDesignUrl(location.href, state.design),
    thumbnailSvg: createDesignThumbnailSvg(state.design, renderer),
    source: isReal ? 'real' : 'procedural',
    seedOrPlace: isReal ? placeName : String(state.design.seed),
    ...(isReal && { terrain: getSavedTerrain(state) }),
    ...(route && { route: toSavedRoute(route) }),
  };
}

function getSavedTerrain(state: StudioState): SavedTerrain {
  const { latitude, longitude, spanKm, elevationFloor, maxDepth, place } = state.source;

  return {
    latitude,
    longitude,
    spanKm,
    maxDepth,
    place,
    ...(elevationFloor !== undefined && { elevationFloor }),
  };
}

function describeSavedDesign(design: SavedDesign): string {
  const savedAt = new Date(design.savedAt);
  const date = Number.isNaN(savedAt.getTime())
    ? ''
    : savedAt.toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });
  const detail = design.source === 'real' ? design.seedOrPlace : `Seed ${design.seedOrPlace}`;

  return date === '' ? detail : `${detail} · ${date}`;
}
