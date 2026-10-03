// Status words for checks, conclusions, captures and artifacts, each with one
// meaning. Label tables take their words from here, and
// docs/PRODUCT.md#report-behavior lists the same words.
export const statusWords = {
  passed: {
    word: 'Passed',
    meaning: "The evidence met the check's expectation.",
  },
  failed: {
    word: 'Failed',
    meaning: "The evidence did not meet the check's expectation.",
  },
  regression: {
    word: 'Regression',
    meaning:
      'The check passed on the base and fails the same expectation on the candidate.',
  },
  unknown: {
    word: 'Unknown',
    meaning:
      'The evidence that the check needs is missing, incomplete, or not comparable.',
  },
  notRun: {
    word: 'Not run',
    meaning: 'The check or step did not run in this capture.',
  },
  changed: {
    word: 'Changed',
    meaning: 'The evidence differs between base and candidate.',
  },
  hashMatched: {
    word: 'Hash matched',
    meaning: "The artifact's SHA-256 matches the one the capture recorded.",
  },
  checkFailed: {
    word: 'Check failed',
    meaning: 'A named check failed with no comparable passing base.',
  },
  noRegression: {
    word: 'No regression',
    meaning:
      'Every named check that ran passed on the candidate, and at least one ran. It says nothing about files that no check covered.',
  },
  noRegressionInNamedChecks: {
    word: 'No regression in the named checks',
    meaning:
      'Every named check that ran passed on the candidate, and at least one changed file is not observed.',
  },
  notChecked: {
    word: 'Not checked',
    meaning: 'Both versions were captured, and no named check ran.',
  },
  unavailable: {
    word: 'Unavailable',
    meaning: 'Evidence that the result needs is missing or not comparable.',
  },
  preview: {
    word: 'Preview',
    meaning: 'One capture of the current application, with no base.',
  },
  complete: {
    word: 'Complete',
    meaning: 'The capture ran every step and recorded its evidence.',
  },
  captureFailed: {
    word: 'Capture failed',
    meaning: 'The capture stopped before it recorded its evidence.',
  },
  checked: {
    word: 'Checked',
    meaning:
      'A named check evaluated evidence that points into the changed file.',
  },
  exercised: {
    word: 'Exercised',
    meaning:
      'Recorded evidence shows that the changed file ran. It says nothing about whether it ran correctly.',
  },
  notObserved: {
    word: 'Not observed',
    meaning: 'No recorded evidence touched the changed file.',
  },
  outsideCapturedSource: {
    word: 'Outside the captured source',
    meaning: 'The file changed, and neither source snapshot contains it.',
  },
} as const;
