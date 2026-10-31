import {
  Activity,
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { RouteProfileHost } from './route-profile-host';
import { hasRouteProfile } from './active-route-analysis';
import { createRoot } from 'react-dom/client';
import { createPortal, flushSync } from 'react-dom';
import { InspectorPanel } from '../ui/inspector-panel';
import {
  getActiveSection,
  getHiddenSections,
  type StudioController,
  type StudioMode,
  type InspectorSection,
  type PanelProps,
} from './controller';
import { createModeFlip, type ModeFlip } from './mode-flip';
import { isTextField } from '../system/browse-keys';
import { DossierPanel } from './dossier-panel';
import { ExportPanel } from './export-panel';
import { ControlGroup } from '../ui/control-group';
import { GlassPanel } from '../ui/glass-panel';
import { Button } from '../ui/button';
import { StatusMessage } from '../ui/status-message';
import { TextField } from '../ui/text-field';
import { IconButton } from '../ui/icon-button';
import { createPinnedPlaceholder } from '../ui/layout-manager';
import { buildSectionGroups } from './control-groups';
import { StudioPinnedPanels } from './pinned-panels';
import { getGroupCode, studioSections } from './sections';
import { CommandPaletteHost, isCommandPaletteShortcut } from './command-palette-host';
import { commandPaletteDialogClassName } from '../ui/command-palette';
import { StudioHeader } from './studio-header';
import { StudioFooter } from './studio-footer';
import { StudioMapControls, StudioSheet } from './studio-sheet';
import { ViewportStates } from './viewport-states';
import { StudioHud } from './studio-hud';
import { AnalyticsConsentDialog, useAnalyticsConsentPrompt } from './analytics-consent-dialog';
import { CompareHost } from './compare-host';
import type { CompareSceneStore } from './compare-scene';
import { StudioToolBar } from './studio-tools';
import type { HudStore } from './hud-store';
import type { CropPreview } from './crop-preview';
import type { OutputRenderer } from '../types/export';
import { PhonePages } from './pages/phone-pages';
import { operationErrorCodes } from '../constants/operations';
import { logOperationError } from '../operation-logging';
import type { OperationError } from '../types/operations';

const inspectorId = 'studio-inspector';

// The design-system gallery is its own chunk: the studio bundle never carries the registry or specimens.
const loadSystemMode = () => import('../system/system-mode');
const systemModeLoadError: OperationError = {
  code: operationErrorCodes.moduleLoadFailed,
  message: 'The design system could not load. Check your connection, then try again.',
  retryable: true,
};

/** Below this the inspector becomes a bottom sheet with a horizontal section strip. */
export const phoneViewportQuery = '(max-width: 767px)';

function Surface({
  title,
  close,
  children,
  modal = false,
  bareClassName,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  modal?: boolean;
  /** Renders the children with no heading, in a dialog with this class; they bring their own panel. */
  bareClassName?: string;
}): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);

  closeRef.current = close;
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;

    if (!dialog) {
      return;
    }

    if (modal) {
      dialog.showModal();
    } else {
      dialog.show();
    }

    const focusable = dialog.querySelector<HTMLElement>('button, input, select, a[href]');

    focusable?.focus();

    const dismissOutside = (event: PointerEvent) => {
      if (
        !modal &&
        event.target instanceof Node &&
        !dialog.contains(event.target) &&
        !(event.target instanceof Element && event.target.closest('[aria-haspopup="dialog"]'))
      ) {
        closeRef.current();
      }
    };

    document.addEventListener('pointerdown', dismissOutside);

    return () => {
      document.removeEventListener('pointerdown', dismissOutside);
      dialog.close();

      if (previous instanceof HTMLElement && previous.isConnected) {
        previous.focus();
      }
    };
  }, [modal]);

  return (
    <dialog
      ref={ref}
      className={bareClassName ?? `lc-popover${modal ? ' lc-popover--modal' : ''}`}
      data-ui-surface
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          close();
        }

        if (event.key === 'Tab' && !modal) {
          const items = [
            ...event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]',
            ),
          ];
          const first = items[0];
          const last = items.at(-1);

          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      {bareClassName !== undefined ? (
        children
      ) : (
        <GlassPanel padding="none" className="lc-popover__panel">
          <div className="lc-popover__heading">
            <h2 className="lc-popover__title">{title}</h2>
            <IconButton glyph="×" label={`Close ${title}`} onClick={close} />
          </div>
          <div className="lc-popover__body">{children}</div>
        </GlassPanel>
      )}
    </dialog>
  );
}

function Studio({
  controller: c,
  terrain,
  renderer,
  cropPreview,
  hud,
  compareScenes,
}: {
  controller: StudioController;
  terrain: SVGSVGElement;
  renderer: OutputRenderer;
  cropPreview: CropPreview;
  hud: HudStore;
  compareScenes: CompareSceneStore;
}): ReactNode {
  const state = useSyncExternalStore(c.subscribe, c.getSnapshot);
  const viewport = useRef<HTMLDivElement>(null);
  const inspectorToggle = useRef<HTMLButtonElement>(null);
  const systemLink = useRef<HTMLButtonElement>(null);
  const active = getActiveSection(state);
  const isPhoneViewport = useSyncExternalStore(subscribeToPhoneViewport, readIsPhoneViewport);
  const analyticsConsent = useAnalyticsConsentPrompt();
  const [modeFlip] = useState(() => createStudioModeFlip(c));
  const flip = useSyncExternalStore(modeFlip.subscribe, modeFlip.getSnapshot);
  const isSystemShown = !isPhoneViewport && flip.shownMode === 'system';
  const previousShownMode = useRef(flip.shownMode);
  // Mounted on first entry (the chunk is lazy), then kept: Activity hides whichever side is off
  // screen, so studio tools, Find and plate values all survive a round trip.
  const [isSystemMounted, setIsSystemMounted] = useState(isSystemShown);
  // Stable, so system mode's effects that depend on it don't re-run on every studio render.
  const selectSystemPart = useCallback(
    (systemPartId: string) => {
      c.workspace({ systemPartId });
    },
    [c],
  );

  if (isSystemShown && !isSystemMounted) {
    setIsSystemMounted(true);
  }

  // A rejected lazy import stays rejected, so a failed load swaps in a fresh one for the retry.
  const [SystemMode, setSystemMode] = useState(() => lazy(loadSystemMode));

  // Opening from the studio moves focus into the gallery; a link straight in leaves it alone.
  const [isSystemOpenedFromStudio, setIsSystemOpenedFromStudio] = useState(false);

  const requestMode = (mode: StudioMode) => {
    if (mode === 'system') {
      preloadSystemMode();
      setIsSystemOpenedFromStudio(true);
    }

    modeFlip.request(mode);
  };

  useLayoutEffect(() => {
    viewport.current?.append(terrain);
  }, [terrain]);
  useEffect(() => modeFlip.dispose, [modeFlip]);
  // Leaving system mode hides the focused control; land on the link that opens it again.
  useEffect(() => {
    const wasSystem = previousShownMode.current === 'system';

    previousShownMode.current = flip.shownMode;

    const focused = document.activeElement;
    // Hidden by Activity, not yet blurred: the browser moves focus off it only on its next frame.
    const isFocusLost = focused === null || focused === document.body || !focused.checkVisibility();

    if (wasSystem && flip.shownMode === 'studio' && isFocusLost) {
      systemLink.current?.focus();
    }
  }, [flip.shownMode]);
  // System mode is desktop-only, and a mode set elsewhere (a link, a phone rotation) shows without a flip.
  useEffect(() => {
    if (isPhoneViewport && state.workspace.mode === 'system') {
      c.workspace({ mode: 'studio' });
    } else if (!flip.isBusy && flip.shownMode !== state.workspace.mode) {
      modeFlip.snapTo(state.workspace.mode);
    }
  }, [c, modeFlip, isPhoneViewport, state.workspace.mode, flip.isBusy, flip.shownMode]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return;
      }

      if (state.cameraShots.isPlaying) {
        c.stopCameraShots();
      } else if (state.workspace.mode === 'system') {
        if (!isTextField(event.target)) {
          modeFlip.request('studio');
        }
      } else if (state.workspace.exporting) {
        c.workspace({ exporting: false });
      } else if (state.workspace.compare !== null) {
        c.endCompare();
      } else if (state.workspace.comparePresetsOpen) {
        c.workspace({ comparePresetsOpen: false });
      } else if (!isPhoneViewport && !state.workspace.collapsed) {
        c.workspace({ collapsed: true });
        inspectorToggle.current?.focus();
      }
    };

    document.addEventListener('keydown', escape);

    return () => {
      document.removeEventListener('keydown', escape);
    };
  }, [c, modeFlip, state.workspace, state.cameraShots.isPlaying, isPhoneViewport]);
  useEffect(() => {
    // Director shortcuts: B saves a shot, Shift+B clears them, P plays or stops the tour.
    const directCameraShots = (event: KeyboardEvent) => {
      const { workspace } = c.getSnapshot();

      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.repeat ||
        isTextField(event.target) ||
        workspace.mode !== 'studio' ||
        workspace.view !== '3d' ||
        // Modal surfaces own the keyboard; the tour must not start behind them.
        workspace.exporting ||
        workspace.dossierOpen ||
        workspace.palette !== null ||
        workspace.routeReplacement !== null ||
        c.getSnapshot().manualLink !== ''
      ) {
        return;
      }

      if (event.code === 'KeyB') {
        if (event.shiftKey) {
          c.clearCameraShots();
        } else {
          c.saveCameraShot();
        }
      } else if (event.code === 'KeyP' && !event.shiftKey) {
        c.toggleCameraShotPlayback();
      }
    };

    document.addEventListener('keydown', directCameraShots);

    return () => {
      document.removeEventListener('keydown', directCameraShots);
    };
  }, [c]);
  useEffect(() => {
    const openPalette = (event: KeyboardEvent) => {
      if (!isCommandPaletteShortcut(event) || c.getSnapshot().workspace.mode === 'system') {
        return;
      }

      event.preventDefault();

      if (c.getSnapshot().workspace.palette === null) {
        c.workspace({ palette: { query: '' } });
      }
    };

    document.addEventListener('keydown', openPalette);

    return () => {
      document.removeEventListener('keydown', openPalette);
    };
  }, [c]);
  const [isRouteProfileCollapsed, setIsRouteProfileCollapsed] = useState(false);
  const props = { controller: c, state };
  const routeProfile = hasRouteProfile(state) ? (
    <RouteProfileHost
      controller={c}
      state={state}
      isCollapsed={isRouteProfileCollapsed}
      onCollapsedChange={setIsRouteProfileCollapsed}
    />
  ) : undefined;

  return (
    <div
      className="studio-shell"
      inert={analyticsConsent.isAsking}
      data-route-profile={
        !isPhoneViewport && routeProfile !== undefined
          ? isRouteProfileCollapsed
            ? 'collapsed'
            : 'open'
          : undefined
      }
      data-sheet-snap={isPhoneViewport ? state.workspace.sheetSnap : undefined}
      data-page-hidden={isPhoneViewport && state.workspace.page !== 'studio' ? true : undefined}
      data-mode-target={isPhoneViewport ? 'studio' : state.workspace.mode}
      data-flip={flip.isBusy ? flip.transition : undefined}
      style={
        flip.isBusy
          ? ({ '--lc-mode-flip-angle': `${String(flip.angleDegrees)}deg` } as CSSProperties)
          : undefined
      }
    >
      <main
        id="studio-viewport"
        className="studio-viewport"
        ref={viewport}
        aria-label={`${state.workspace.view.toUpperCase()} landscape viewport`}
        // From the start of the fold-out, not the swap: the canvas takes no input once leaving.
        inert={isSystemShown || state.workspace.mode === 'system'}
      />
      <div className="studio-ground" aria-hidden="true" />
      {analyticsConsent.isAsking &&
        createPortal(<AnalyticsConsentDialog onChoose={analyticsConsent.choose} />, document.body)}
      {flip.isBusy && <div key={flip.sweepCount} className="studio-scan" aria-hidden="true" />}
      {isSystemMounted && (
        <Activity mode={isSystemShown ? 'visible' : 'hidden'}>
          <SystemModeBoundary
            onFailure={() => {
              logOperationError(systemModeLoadError);
              setSystemMode(() => lazy(loadSystemMode));
              setIsSystemMounted(false);
              modeFlip.snapTo('studio');
              c.workspace({ mode: 'studio' });
              c.notify(systemModeLoadError.message);
            }}
          >
            <Suspense fallback={null}>
              <SystemMode
                partId={state.workspace.systemPartId}
                isFocusedOnEntry={isSystemOpenedFromStudio}
                onSelectPart={selectSystemPart}
                onExit={() => {
                  requestMode('studio');
                }}
              />
            </Suspense>
          </SystemModeBoundary>
        </Activity>
      )}
      <Activity mode={isSystemShown ? 'hidden' : 'visible'}>
        <>
          <StudioHeader controller={c} state={state} isPhoneViewport={isPhoneViewport} />
          <ViewportStates controller={c} state={state} />
          {!isPhoneViewport && <CompareHost controller={c} state={state} scenes={compareScenes} />}
          <StudioHud controller={c} state={state} hud={hud} />
          {isPhoneViewport ? (
            <>
              <StudioMapControls controller={c} state={state} />
              <StudioSheet
                controller={c}
                state={state}
                hud={hud}
                id={inspectorId}
                routeProfile={routeProfile}
                renderSection={(section) => renderSectionBody(section, props, cropPreview)}
              />
              <PhonePages controller={c} state={state} renderer={renderer} />
            </>
          ) : (
            <>
              <InspectorPanel
                id={inspectorId}
                label="Landscape controls"
                railLabel="Editing section"
                sections={studioSections}
                activeSectionId={active}
                onSelectSection={(section) => {
                  c.selectSection(section);
                }}
                hiddenSectionIds={getHiddenSections(state)}
                isCollapsed={state.workspace.collapsed}
                headerTag={`Src · ${state.source.terrain ? 'Real' : 'Procedural'}`}
                renderSection={(section) =>
                  renderSectionBody(section, props, cropPreview, {
                    pinnedGroupIds: new Set(state.workspace.pinnedGroups.map(({ id }) => id)),
                    pin: c.pinGroup,
                    dock: c.dockGroup,
                  })
                }
              />
              <StudioPinnedPanels controller={c} state={state} cropPreview={cropPreview} />
              <StudioToolBar controller={c} state={state} />
              {routeProfile !== undefined && (
                <div className="studio-route-profile">{routeProfile}</div>
              )}
              <StudioFooter
                controller={c}
                state={state}
                inspectorId={inspectorId}
                inspectorToggleRef={inspectorToggle}
                systemLinkRef={systemLink}
                onOpenSystem={() => {
                  requestMode('system');
                }}
                onPreloadSystem={preloadSystemMode}
              />
            </>
          )}
        </>
      </Activity>
      {state.workspace.exporting && (
        <Surface
          modal
          title="Export"
          close={() => {
            c.workspace({ exporting: false });
          }}
        >
          <ExportPanel {...props} renderer={renderer} />
        </Surface>
      )}
      {state.workspace.dossierOpen && (
        <Surface
          modal
          title="Model dossier"
          close={() => {
            c.workspace({ dossierOpen: false });
          }}
        >
          <DossierPanel {...props} renderer={renderer} hud={hud} />
        </Surface>
      )}
      {state.workspace.palette !== null && (
        <Surface
          modal
          bareClassName={commandPaletteDialogClassName}
          title="Command palette"
          close={() => {
            c.workspace({ palette: null });
          }}
        >
          <CommandPaletteHost controller={c} state={state} isMobile={isPhoneViewport} />
        </Surface>
      )}
      {state.manualLink !== '' && (
        <Surface
          modal
          title="Copy style link"
          close={() => {
            c.dismissManualLink();
          }}
        >
          <div className="studio-copy-link">
            <StatusMessage kind="info">
              Clipboard access is unavailable. Select and copy this link. Location and 3D settings
              are excluded.
            </StatusMessage>
            <TextField label="Copy this link" value={state.manualLink} isReadOnly />
            <Button
              variant="primary"
              onClick={() => {
                c.dismissManualLink();
              }}
            >
              Done
            </Button>
          </div>
        </Surface>
      )}
    </div>
  );
}

/** Desktop only: groups can float out of the inspector, leaving a placeholder behind. */
interface GroupPinning {
  pinnedGroupIds: ReadonlySet<string>;
  pin: (id: string) => void;
  dock: (id: string) => void;
}

/** A section's control groups; with `pinning`, pinnable groups get a pin button. */
function renderSectionBody(
  section: InspectorSection,
  props: PanelProps,
  cropPreview: CropPreview,
  pinning?: GroupPinning,
): ReactNode {
  return buildSectionGroups(section, props.controller, props.state, cropPreview).map((group) => {
    const code = getGroupCode(group.id);

    if (pinning?.pinnedGroupIds.has(group.id) === true) {
      const placeholder = createPinnedPlaceholder(group, () => {
        pinning.dock(group.id);
      });

      return <ControlGroup key={group.id} group={placeholder} code={code} />;
    }

    return (
      <ControlGroup
        key={group.id}
        group={group}
        code={code}
        onPin={
          pinning &&
          (() => {
            pinning.pin(group.id);
          })
        }
      />
    );
  });
}

/** Starts fetching the system chunk early; a failure surfaces through SystemModeBoundary on render. */
function preloadSystemMode(): void {
  loadSystemMode().catch(() => undefined);
}

/** Catches a system chunk that fails to load, so the shell never goes blank. */
class SystemModeBoundary extends Component<
  { onFailure: () => void; children: ReactNode },
  { hasFailed: boolean }
> {
  override state = { hasFailed: false };

  static getDerivedStateFromError(): { hasFailed: boolean } {
    return { hasFailed: true };
  }

  override componentDidCatch(): void {
    this.props.onFailure();
  }

  override render(): ReactNode {
    return this.state.hasFailed ? null : this.props.children;
  }
}

function createStudioModeFlip(c: StudioController): ModeFlip {
  return createModeFlip({
    initialMode: c.getSnapshot().workspace.mode,
    commit: (mode) => {
      c.workspace({ mode });
    },
    prefersReducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
    timers: {
      setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
      clearTimeout: (handle) => {
        window.clearTimeout(handle);
      },
    },
  });
}

function subscribeToPhoneViewport(onChange: () => void): () => void {
  const query = matchMedia(phoneViewportQuery);

  query.addEventListener('change', onChange);

  return () => {
    query.removeEventListener('change', onChange);
  };
}

function readIsPhoneViewport(): boolean {
  return matchMedia(phoneViewportQuery).matches;
}

export function mountStudio(
  controller: StudioController,
  terrain: SVGSVGElement,
  renderer: OutputRenderer,
  cropPreview: CropPreview,
  hud: HudStore,
  compareScenes: CompareSceneStore,
): void {
  const root = document.createElement('div');

  root.id = 'studio';
  document.body.append(root);
  flushSync(() => {
    createRoot(root).render(
      <Studio
        controller={controller}
        terrain={terrain}
        renderer={renderer}
        cropPreview={cropPreview}
        hud={hud}
        compareScenes={compareScenes}
      />,
    );
  });
}
