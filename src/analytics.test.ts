import assert from 'node:assert/strict';
import test from 'node:test';
import { track } from './analytics';

void test('track sends a typed event to gtag', () => {
  const calls: unknown[][] = [];

  track('export', { format: 'svg' }, (...call) => calls.push(call));

  assert.deepEqual(calls, [['event', 'export', { format: 'svg' }]]);
});

void test('track is silent without gtag and when gtag throws', () => {
  assert.doesNotThrow(() => {
    track('walk_start', {});
    track('walk_start', {}, () => {
      throw new Error('blocked');
    });
  });
});
