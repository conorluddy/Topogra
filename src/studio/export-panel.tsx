import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExportSheet } from '../ui/export-sheet';
import { SuccessSheet, type SuccessRow } from '../ui/success-sheet';
import { terrainStillScales, type TerrainStillScale } from '../export/still-export';
import type { PanelProps } from './controller';
import type { OutputRenderer } from '../types/export';
import type { FramePartId } from '../types/frame';
import { track } from '../analytics';
import { createExportFile, createExportPreviewSvg, downloadExport } from '../export/image-export';
import { maximumOutputDimensionPixels } from '../constants/design';
import { clampOutputDimensionPixels } from '../design-settings';
import { buildExportSheetModel, getFrameParts } from './export-sheet-model';

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

/** Adapter: builds the ExportSheet view model from the controller and owns the download handlers. */
export function ExportPanel({
  controller: c,
  state: s,
  renderer,
}: PanelProps & { renderer: OutputRenderer }): ReactNode {
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [sizeChoice, setSizeChoice] = useState('custom');
  const [stillScale, setStillScale] = useState<TerrainStillScale>(2);
  const [isStillBusy, setIsStillBusy] = useState(false);
  const [deselectedPartIds, setDeselectedPartIds] = useState<ReadonlySet<FramePartId>>(new Set());
  const [successTitle, setSuccessTitle] = useState<string | undefined>(undefined);
  const activePreview = useRef<string | undefined>(undefined);
  const successAnchor = useRef<HTMLDivElement>(null);
  const settings = s.design;
  const frameParts = getFrameParts(s);

  useEffect(() => {
    let cancelled = false;
    let pendingUrl: string | undefined;
    const frame = requestAnimationFrame(() => {
      void (async () => {
        try {
          pendingUrl = URL.createObjectURL(
            new Blob([createExportPreviewSvg(settings, renderer)], { type: 'image/svg+xml' }),
          );
          const image = new Image();

          image.src = pendingUrl;
          await image.decode();

          if (cancelled) {
            URL.revokeObjectURL(pendingUrl);

            return;
          }

          const previous = activePreview.current;

          activePreview.current = pendingUrl;
          setPreviewUrl(pendingUrl);
          pendingUrl = undefined;
          setError('');

          if (previous !== undefined) {
            URL.revokeObjectURL(previous);
          }
        } catch (failure) {
          if (pendingUrl !== undefined) {
            URL.revokeObjectURL(pendingUrl);
          }

          if (!cancelled) {
            setError(
              failure instanceof Error ? failure.message : 'Preview could not be generated.',
            );
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, [settings, renderer, s.source.terrain]);
  useEffect(
    () => () => {
      if (activePreview.current !== undefined) {
        URL.revokeObjectURL(activePreview.current);
      }
    },
    [],
  );
  useEffect(() => {
    successAnchor.current?.scrollIntoView({ block: 'nearest' });
  }, [successTitle]);

  const download = async () => {
    setIsBusy(true);
    setError('');

    try {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            resolve();
          }),
        ),
      );
      const result = await createExportFile(settings, renderer);
      const downloaded = result.ok ? downloadExport(result.data) : result;

      if (!downloaded.ok) {
        setError(downloaded.error.message);
      } else {
        track('export', { format: settings.format });
        c.notify('Download started.');
        setSuccessTitle(`${settings.format.toUpperCase()} downloaded`);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Export failed. Please retry.');
    } finally {
      setIsBusy(false);
    }
  };

  const changeSizeChoice = (value: string) => {
    setSizeChoice(value);

    if (value === 'custom') {
      return;
    }

    const [width, height] = resolvePresetSize(value);

    c.design({
      width: clampOutputDimensionPixels(Math.round(width)),
      height: clampOutputDimensionPixels(Math.round(height)),
    });

    if (value === 'viewport' || value === 'screen') {
      setSizeChoice('custom');
    }
  };

  const model = buildExportSheetModel({
    state: s,
    ui: {
      previewUrl,
      error,
      isBusy,
      sizeChoice,
      stillScale,
      isStillBusy,
      selectedPartIds: new Set(
        frameParts.map(({ id }) => id).filter((id) => !deselectedPartIds.has(id)),
      ),
      success:
        successTitle === undefined ? undefined : (
          <div ref={successAnchor}>
            <SuccessSheet
              title={successTitle}
              rows={buildSuccessRows(c)}
              onDone={() => {
                setSuccessTitle(undefined);
              }}
            />
          </div>
        ),
    },
    handlers: {
      changeFormat: (value) => c.design({ format: value === 'png' ? 'png' : 'svg' }),
      changeSizeChoice,
      changeWidth: (value) => {
        setSizeChoice('custom');

        return value !== undefined && c.design({ width: value });
      },
      changeHeight: (value) => {
        setSizeChoice('custom');

        return value !== undefined && c.design({ height: value });
      },
      changeResolution: (value) => c.design({ pngScale: value === '2' ? 2 : 1 }),
      setTransparent: (value) => c.design({ transparent: value }),
      setExtraLargeAllowed: (value) =>
        c.design({
          allowExtraLargeExports: value,
          ...(!value
            ? {
                width: Math.min(settings.width, maximumOutputDimensionPixels),
                height: Math.min(settings.height, maximumOutputDimensionPixels),
              }
            : {}),
        }),
      failPreview: () => {
        setError('Export preview could not be displayed.');
      },
      download: () => {
        void download();
      },
      changeStillScale: (value) => {
        const scale = terrainStillScales.find((candidate) => String(candidate) === value);

        if (scale !== undefined) {
          setStillScale(scale);
        }
      },
      downloadStill: () => {
        setIsStillBusy(true);
        void c
          .downloadStill(stillScale)
          .then(() => {
            setSuccessTitle('Still image saved');
          })
          .finally(() => {
            setIsStillBusy(false);
          });
      },
      downloadStl: () => {
        if (c.downloadStl()) {
          setSuccessTitle('STL downloaded');
        }
      },
      downloadPart: (partId) => {
        if (c.downloadFrameStl(partId)) {
          setSuccessTitle(`${partId} STL downloaded`);
        }
      },
      setPartSelected: (partId, isSelected) => {
        setDeselectedPartIds((previous) => {
          const next = new Set(previous);

          if (isSelected) {
            next.delete(partId);
          } else {
            next.add(partId);
          }

          return next;
        });
      },
      downloadSelectedParts: () => {
        const partIds = frameParts.map(({ id }) => id).filter((id) => !deselectedPartIds.has(id));

        void c.downloadFrameStlParts(partIds).then(() => {
          if (c.getSnapshot().exportJobs.every(({ status }) => status === 'done')) {
            setSuccessTitle(
              partIds.length === 1
                ? `${partIds[0]} STL downloaded`
                : `${String(partIds.length)} frame parts downloaded`,
            );
          }
        });
      },
      openDossier: () => {
        c.workspace({ dossierOpen: true });
      },
      downloadAttribution: () => {
        downloadBlob(
          new Blob([s.source.terrain?.attribution ?? ''], { type: 'text/plain' }),
          `landcube-${settings.seed}-attribution.txt`,
        );
      },
    },
  });

  return <ExportSheet model={model} />;
}

// === HELPERS ===

function resolvePresetSize(value: string): [number, number] {
  if (value === 'viewport') {
    return [window.innerWidth, window.innerHeight];
  }

  if (value === 'screen') {
    return [window.screen.width * devicePixelRatio, window.screen.height * devicePixelRatio];
  }

  const [width, height] = value.split('x').map(Number);

  return [width, height];
}

/** Share needs the Web Share API; send-to-printer and file reveal have no backend yet (OQ-3 in #94). */
function buildSuccessRows(c: PanelProps['controller']): SuccessRow[] {
  const canShare = typeof navigator.share === 'function';

  return [
    {
      glyph: '▤',
      label: 'Files',
      detail: 'Saved by your browser. Check its downloads folder.',
      onClick: () => {
        c.notify('Your browser saved the file to its downloads folder.');
      },
    },
    ...(canShare
      ? [
          {
            glyph: '↗',
            label: 'Share',
            onClick: () => {
              void navigator
                .share({ title: 'LANDCU.BE', url: window.location.href })
                .catch((failure: unknown) => {
                  // Dismissing the share sheet is not a failure.
                  if (!(failure instanceof DOMException && failure.name === 'AbortError')) {
                    c.notify('Sharing failed. Copy the style link instead.');
                  }
                });
            },
          },
        ]
      : []),
    {
      glyph: '⎙',
      label: 'Send to printer',
      onClick: () => undefined,
      isDisabled: true,
      tag: 'Soon',
    },
    {
      glyph: '⧉',
      label: 'Copy style link',
      onClick: () => {
        void c.copyLink();
      },
    },
  ];
}
