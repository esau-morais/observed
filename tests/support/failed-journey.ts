import { compareJourney } from '../../src/comparison';
import type { Journey, Side } from '../../src/comparison-model';

// Artifacts a capture writes before its setup runs.
const beforeSetup = /^(source|recipe|transcript|project|owner)/;

// The journey as the comparator reads it when setup failed on both sides
// before the browser recorded anything, as with a stale self-observe fixture.
export function failedJourney(
  journey: Journey,
  reason: string,
  evaluatedAt: string,
): Journey {
  const { base, candidate } = journey;

  if (base.execution !== 'complete' || candidate.execution !== 'complete') {
    throw new Error('The fixture captures are complete');
  }

  const failed = (side: typeof candidate): Side => {
    const detail = `Capture failed (application): ${reason}`;

    return {
      execution: 'capture-failed',
      capture: {
        ...side.capture,
        manifest: {
          ...side.capture.manifest,
          execution: { kind: 'failed', category: 'application', reason },
        },
      },
      recipe: side.recipe,
      evidence: side.evidence.map((view) => ({
        kind: view.kind,
        status: 'unavailable',
        reason: 'The capture recorded no evidence of this kind',
      })),
      screenshot: null,
      checks: side.checks.map((check) => ({
        ...check,
        outcome: 'unknown',
        actual: null,
        detail,
      })),
      artifacts: side.artifacts.filter((artifact) =>
        beforeSetup.test(artifact.id),
      ),
      unresolved: [detail],
    };
  };

  return compareJourney({
    base: failed(base),
    candidate: failed(candidate),
    evaluatedAt,
    visual: { kind: 'unavailable', reason: 'Screenshots were not captured' },
  });
}
