import { expect, test } from 'vitest';
import { toSample } from './performance';

const viewport = { width: 1280, height: 800, scale: 1 };
const reading = {
  observer: true,
  events: true,
  timeOrigin: 1_792_000_000_000.5,
  document: '/',
  viewport,
  interactions: 1,
  lcp: 120,
  fcp: 100,
  cls: 0,
  inp: 24,
  ttfb: 12,
  domContentLoaded: 80,
  load: 140,
};
const run = {
  run: 2,
  warmup: false,
  startedAt: '2026-10-15T00:00:00.000Z',
  finishedAt: '2026-10-15T00:00:01.000Z',
  viewport,
  previousOrigin: null,
};

test('a run that repeats the previous document, has another viewport or no observer is not a sample', () => {
  expect(toSample(reading, run)).toMatchObject({ kind: 'sample', sample: { run: 2 } });
  expect(toSample(reading, { ...run, previousOrigin: reading.timeOrigin })).toEqual({
    kind: 'rejected',
    reason: 'Run 2 did not load a new page, so its timings repeat the previous run',
  });
  expect(toSample(reading, { ...run, viewport: { width: 390, height: 844, scale: 3 } })).toEqual({
    kind: 'rejected',
    reason: 'Browser viewport in run 2 does not match the saved recipe',
  });
  expect(toSample({ ...reading, observer: false }, run)).toEqual({
    kind: 'rejected',
    reason: 'The timing observer did not run on the page in run 2',
  });
});
