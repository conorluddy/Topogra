import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyticsConsentStorageKey,
  applyAnalyticsChoice,
  loadAnalytics,
  startAnalyticsIfAllowed,
  type AnalyticsEnvironment,
  isAnalyticsHost,
  readAnalyticsConsent,
  saveAnalyticsConsent,
} from './analytics-consent';
import type { OperationError } from './types/operations';

function createStorage(initial?: string) {
  const values = new Map<string, string>();

  if (initial !== undefined) {
    values.set(analyticsConsentStorageKey, initial);
  }

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

void test('only the hosted site asks for analytics consent', () => {
  assert.equal(isAnalyticsHost('landcu.be'), true);
  assert.equal(isAnalyticsHost('localhost'), false);
  assert.equal(isAnalyticsHost('someone.github.io'), false);
});

void test('a saved choice is remembered and anything else counts as unset', () => {
  const storage = createStorage();

  assert.equal(readAnalyticsConsent(storage), 'unset');
  assert.deepEqual(saveAnalyticsConsent(storage, 'granted'), { ok: true, data: undefined });
  assert.equal(readAnalyticsConsent(storage), 'granted');
  saveAnalyticsConsent(storage, 'denied');
  assert.equal(readAnalyticsConsent(storage), 'denied');
  assert.equal(readAnalyticsConsent(createStorage('maybe')), 'unset');
});

void test('blocked storage reads as unset and reports a failed save', () => {
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  const saved = saveAnalyticsConsent(blocked, 'granted');

  assert.equal(readAnalyticsConsent(blocked), 'unset');
  assert.equal(saved.ok, false);
});

function createEnvironment(pathname = '/') {
  const appended: unknown[] = [];
  const target: AnalyticsEnvironment['target'] = {};
  const environment: AnalyticsEnvironment = {
    target,
    page: { origin: 'https://landcu.be', pathname },
    document: {
      createElement: () => ({}),
      head: { append: (node: unknown) => appended.push(node) },
    } as unknown as AnalyticsEnvironment['document'],
  };

  return { environment, target, appended };
}

const readCalls = (target: AnalyticsEnvironment['target']) =>
  (target.dataLayer ?? []).map((entry) => Array.from(entry as ArrayLike<unknown>));

void test('starting twice loads the tag once and config omits the design-link query', () => {
  const { environment, target, appended } = createEnvironment('/');
  const storage = createStorage('granted');

  startAnalyticsIfAllowed('landcu.be', storage, environment);
  startAnalyticsIfAllowed('landcu.be', storage, environment);

  const configs = readCalls(target).filter(([command]) => command === 'config');

  assert.equal(configs.length, 1);
  assert.deepEqual(configs[0]?.[2], { page_location: 'https://landcu.be/' });
  assert.equal(appended.length, 1);
});

void test('nothing loads without consent or off the hosted site', () => {
  for (const [hostname, stored] of [
    ['landcu.be', undefined],
    ['landcu.be', 'denied'],
    ['localhost', 'granted'],
  ] as const) {
    const { environment, target, appended } = createEnvironment();

    startAnalyticsIfAllowed(hostname, createStorage(stored), environment);

    assert.equal(target.gtag, undefined, `${hostname} ${String(stored)}`);
    assert.equal(appended.length, 0);
  }
});

void test('allowing saves and loads the tag; declining saves and loads nothing', () => {
  const allowed = createEnvironment();
  const declined = createEnvironment();
  const allowedStorage = createStorage();
  const declinedStorage = createStorage();

  applyAnalyticsChoice('granted', allowedStorage, () => undefined, allowed.environment);
  applyAnalyticsChoice('denied', declinedStorage, () => undefined, declined.environment);

  assert.equal(readAnalyticsConsent(allowedStorage), 'granted');
  assert.equal(allowed.appended.length, 1);
  assert.equal(readAnalyticsConsent(declinedStorage), 'denied');
  assert.equal(declined.appended.length, 0);
  assert.equal(declined.target.gtag, undefined);
});

void test('a failed save is reported and still honours the choice for this visit', () => {
  const { environment, appended } = createEnvironment();
  const reported: OperationError[] = [];
  const blocked = {
    setItem: () => {
      throw new Error('blocked');
    },
  };

  applyAnalyticsChoice('granted', blocked, (error) => reported.push(error), environment);
  loadAnalytics(environment);

  assert.equal(reported.length, 1);
  assert.equal(appended.length, 1);
});
