import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkup } from '../ui/test-helpers';
import { AnalyticsConsentDialog, getTrappedFocusIndex } from './analytics-consent-dialog';

void test('the dialog offers equal accept and decline actions', () => {
  const markup = renderMarkup(<AnalyticsConsentDialog onChoose={() => undefined} />);

  assert.match(markup, /role="alertdialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /No thanks/);
  assert.match(markup, /Allow analytics/);
});

void test('Tab cycles decline, allow, decline and Shift+Tab goes back', () => {
  assert.equal(getTrappedFocusIndex(0, 2, false), 1);
  assert.equal(getTrappedFocusIndex(1, 2, false), 0);
  assert.equal(getTrappedFocusIndex(0, 2, true), 1);
  assert.equal(getTrappedFocusIndex(1, 2, true), 0);
  // Focus outside the dialog (index -1) enters it at the first or last button.
  assert.equal(getTrappedFocusIndex(-1, 2, false), 0);
  assert.equal(getTrappedFocusIndex(-1, 2, true), 1);
});
