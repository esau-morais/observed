import { Schema } from 'effect';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from 'vitest';
import { comparisonSchema, type Comparison } from '../src/comparison-model';
import { agentText } from '../src/viewer/agent-text';
import { outlineJourney } from '../src/viewer/outline';

async function errorsResult(): Promise<Comparison> {
  return Schema.decodeUnknownSync(Schema.fromJsonString(comparisonSchema))(
    await readFile(
      path.join(import.meta.dirname, 'fixtures/report/errors-result.json'),
      'utf8',
    ),
  );
}

function onlyJourney(result: Comparison) {
  const [journey] = result.journeys;

  return journey;
}

test('a failed check leads with its evidence, not identical screenshots', async () => {
  const outline = outlineJourney(onlyJourney(await errorsResult()));
  const screenshots = outline.sections.find(
    (section) => section.key === 'screenshots',
  );

  expect(outline.lead).toBe('timeline');
  expect(outline.sections[0]?.status).toBe('failed');
  expect(outline.placement.get('no-browser-errors')).toBe('timeline');
  expect(screenshots).toMatchObject({ status: 'neutral', count: 'identical' });
  expect(outline.sections[0]?.open).toBe(true);
  expect(
    outline.sections.find((section) => section.key === 'checks'),
  ).toMatchObject({ status: 'failed', open: false });
});

test('screenshots lead once no check fails', async () => {
  const result = await errorsResult();
  const journey = onlyJourney(result);
  const outline = outlineJourney({
    ...journey,
    checks: journey.checks.map((check) => ({ ...check, verdict: 'passed' })),
  });

  expect(outline.lead).toBe('screenshots');
  expect(outline.sections[0]).toMatchObject({ key: 'screenshots', open: true });
});

test('missing candidate evidence marks its section unknown, never passed', async () => {
  const journey = onlyJourney(await errorsResult());
  const candidate = journey.candidate;

  if (candidate.execution !== 'complete') {
    throw new Error('The fixture candidate is complete');
  }

  const outline = outlineJourney({
    ...journey,
    checks: journey.checks.map((check) => ({ ...check, verdict: 'passed' })),
    candidate: {
      ...candidate,
      evidence: candidate.evidence.map((view) =>
        view.kind === 'accessibility'
          ? { kind: view.kind, status: 'unavailable', reason: 'Synthetic gap' }
          : view,
      ),
    },
  });

  expect(
    outline.sections.find((section) => section.key === 'accessibility'),
  ).toMatchObject({ status: 'unknown', count: 'unavailable' });
  expect(outline.lead).toBe('accessibility');
});

test('steps turn unknown when the browser errors they show are missing', async () => {
  const journey = onlyJourney(await errorsResult());
  const candidate = journey.candidate;

  if (candidate.execution !== 'complete') {
    throw new Error('The fixture candidate is complete');
  }

  const outline = outlineJourney({
    ...journey,
    checks: [],
    candidate: {
      ...candidate,
      evidence: candidate.evidence.map((view) =>
        view.kind === 'browser-errors'
          ? { kind: view.kind, status: 'unavailable', reason: 'Synthetic gap' }
          : view,
      ),
    },
  });
  const steps = outline.sections.find((section) => section.key === 'timeline');

  expect(steps?.status).toBe('unknown');
  expect(steps?.count).toContain('errors unavailable');
});

test('agent text names verified bundle files and the verification rule', async () => {
  const result = await errorsResult();
  const journey = onlyJourney(result);
  const [first, ...rest] = journey.candidate.artifacts.filter(
    (artifact) => artifact.id === 'evidence-browser-errors',
  );

  if (first?.integrity !== 'verified' || rest.length > 0) {
    throw new Error('The fixture holds one verified browser-errors file');
  }

  const text = agentText(result);
  const withMissingFile = agentText({
    ...result,
    journeys: [
      {
        ...journey,
        candidate: {
          ...journey.candidate,
          artifacts: journey.candidate.artifacts.map((artifact) =>
            artifact.id === first.id
              ? {
                  id: artifact.id,
                  description: artifact.description,
                  integrity: 'unavailable',
                  reason: 'Synthetic hash mismatch',
                }
              : artifact,
          ),
        },
      },
    ],
  });

  expect(text).toContain(`Candidate: ${first.path}`);
  expect(text).toContain('Location: thrown at src/App.jsx:10.');
  expect(text).toContain(
    journey.candidate.capture?.manifest.source.sha256 ?? 'missing',
  );
  expect(text).not.toContain('/source/');
  expect(withMissingFile).not.toContain(first.path);
});
