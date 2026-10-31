/** Consent for Google Analytics on the hosted site: the tag loads only after a visitor allows it. */

import { operationErrorCodes } from './constants/operations';
import type { OperationError, Result } from './types/operations';

export const analyticsHostname = 'landcu.be';
export const analyticsConsentStorageKey = 'landcube-analytics-consent';

const measurementId = 'G-09DGBRV9NB';

export type AnalyticsConsent = 'granted' | 'denied' | 'unset';

// === PUBLIC API ===

/** Only the hosted site reports, so dev servers, forks and self-hosts neither ask nor load the tag. */
export function isAnalyticsHost(hostname: string): boolean {
  return hostname === analyticsHostname;
}

/** The remembered choice; unreadable storage counts as no choice yet. */
export function readAnalyticsConsent(storage: Pick<Storage, 'getItem'>): AnalyticsConsent {
  try {
    const stored = storage.getItem(analyticsConsentStorageKey);

    return stored === 'granted' || stored === 'denied' ? stored : 'unset';
  } catch {
    return 'unset';
  }
}

/** Remembers the choice; a failure means the dialog asks again next visit. */
export function saveAnalyticsConsent(
  storage: Pick<Storage, 'setItem'>,
  consent: 'granted' | 'denied',
): Result<void> {
  try {
    storage.setItem(analyticsConsentStorageKey, consent);

    return { ok: true, data: undefined };
  } catch {
    return {
      ok: false,
      error: {
        code: operationErrorCodes.storageFailed,
        message: 'Browser storage is unavailable, so the analytics choice will not be remembered.',
        retryable: true,
      },
    };
  }
}

/** What loading the tag touches, injectable so tests need no browser. */
export interface AnalyticsEnvironment {
  target: { dataLayer?: unknown[]; gtag?: unknown };
  page: Pick<Location, 'origin' | 'pathname'>;
  document: Pick<Document, 'createElement' | 'head'>;
}

/** Loads Google Analytics once. Set on config so every event, not just the page view, omits the design-link query. */
export function loadAnalytics(environment: AnalyticsEnvironment = getBrowserEnvironment()): void {
  const { target, page } = environment;

  if (target.gtag !== undefined) {
    return;
  }

  const dataLayer = (target.dataLayer ??= []);

  // gtag.js reads `arguments` objects from the data layer, so a rest-parameter array will not do.
  target.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };

  const gtag = target.gtag as (...args: unknown[]) => void;

  gtag('js', new Date());
  gtag('config', measurementId, { page_location: page.origin + page.pathname });

  const tag = environment.document.createElement('script');

  tag.async = true;
  tag.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  environment.document.head.append(tag);
}

/** Starts analytics at launch for a visitor who already allowed it. */
export function startAnalyticsIfAllowed(
  hostname: string,
  storage: Pick<Storage, 'getItem'>,
  environment?: AnalyticsEnvironment,
): void {
  if (isAnalyticsHost(hostname) && readAnalyticsConsent(storage) === 'granted') {
    loadAnalytics(environment);
  }
}

/** Remembers the visitor's answer and loads the tag only for "allow"; a failed save is reported, not fatal. */
export function applyAnalyticsChoice(
  consent: 'granted' | 'denied',
  storage: Pick<Storage, 'setItem'>,
  onSaveFailed: (error: OperationError) => void,
  environment?: AnalyticsEnvironment,
): void {
  const saved = saveAnalyticsConsent(storage, consent);

  if (!saved.ok) {
    onSaveFailed(saved.error);
  }

  if (consent === 'granted') {
    loadAnalytics(environment);
  }
}

function getBrowserEnvironment(): AnalyticsEnvironment {
  return {
    target: window as unknown as AnalyticsEnvironment['target'],
    page: location,
    document,
  };
}
