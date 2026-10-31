import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { applyAnalyticsChoice, isAnalyticsHost, readAnalyticsConsent } from '../analytics-consent';
import { logOperationError } from '../operation-logging';
import { Button } from '../ui/button';
import { SignalMark } from '../ui/signal-mark';
import { browserLocalStorage, type BrowserStorage } from './browser-storage';

export interface AnalyticsConsentPrompt {
  /** True on the hosted site until the visitor has chosen. */
  isAsking: boolean;
  choose: (consent: 'granted' | 'denied') => void;
}

// === PUBLIC API ===

/** Whether to ask for analytics consent, and how to record the answer. */
export function useAnalyticsConsentPrompt(
  hostname: string = location.hostname,
  storage: Pick<BrowserStorage, 'getItem' | 'setItem'> = browserLocalStorage,
): AnalyticsConsentPrompt {
  const [isAsking, setIsAsking] = useState(
    () => isAnalyticsHost(hostname) && readAnalyticsConsent(storage) === 'unset',
  );

  return {
    isAsking,
    choose: (consent) => {
      applyAnalyticsChoice(consent, storage, logOperationError);
      setIsAsking(false);
    },
  };
}

/** Index of the button to focus next; Tab and Shift+Tab wrap, so focus never leaves a modal. */
export function getTrappedFocusIndex(
  activeIndex: number,
  count: number,
  isBackward: boolean,
): number {
  return (activeIndex + (isBackward ? -1 : 1) + count) % count;
}

/** Modal card asking whether anonymous usage analytics may load. Render it only while asking. */
export function AnalyticsConsentDialog({
  onChoose,
}: {
  onChoose: AnalyticsConsentPrompt['choose'];
}): ReactNode {
  const declineButton = useRef<HTMLButtonElement>(null);
  const allowButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;

    declineButton.current?.focus();

    return () => {
      if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, []);

  // The studio behind is inert; this keeps Tab cycling between the two buttons.
  const keepFocusInside = (event: ReactKeyboardEvent): void => {
    if (event.key !== 'Tab') {
      return;
    }

    const buttons = [declineButton.current, allowButton.current];

    event.preventDefault();
    buttons[
      getTrappedFocusIndex(
        buttons.indexOf(document.activeElement as HTMLButtonElement),
        2,
        event.shiftKey,
      )
    ]?.focus();
  };

  return (
    <div className="lc-route-confirm">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label="Usage analytics"
        onKeyDown={keepFocusInside}
      >
        <section className="lc-readout-card lc-glass lc-consent-card" data-ui-surface>
          <div className="lc-readout-card__header">
            <span className="lc-readout-card__label">
              <SignalMark kind="live" />
              Analytics
            </span>
            <span className="lc-readout-card__source">Optional</span>
          </div>
          <div className="lc-readout-card__identity">
            <p className="lc-readout-card__title">Usage data</p>
            <p className="lc-readout-card__place">Google Analytics</p>
          </div>
          <p className="lc-consent-card__body">
            Help improve LANDCU.BE by sharing which features get used and when something fails.
            Google also receives your IP address and browser details. Seeds, locations and routes
            are never sent.
          </p>
          <div className="lc-consent-card__actions">
            <Button
              ref={declineButton}
              isFullWidth
              onClick={() => {
                onChoose('denied');
              }}
            >
              No thanks
            </Button>
            <Button
              ref={allowButton}
              isFullWidth
              onClick={() => {
                onChoose('granted');
              }}
            >
              Allow analytics
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
