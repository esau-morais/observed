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
      'Every named check that ran passed on the candidate, and at least one ran. At least one changed file is not observed.',
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
  addedByChange: {
    word: 'Added by this change',
    meaning:
      "Only the candidate's observed.json defines the check or journey. It has no baseline, so it cannot be a regression.",
  },
  removedByChange: {
    word: 'Removed by this change',
    meaning:
      "Only the base's observed.json defines the check or journey. The base's definition judges the captures when they hold the evidence it needs.",
  },
  alteredByChange: {
    word: 'Altered by this change',
    meaning:
      "The check or journey differs between the two observed.json files. The base's definition judges an altered check. An altered journey leaves its checks unknown.",
  },
  proposed: {
    word: 'Proposed',
    meaning:
      "The candidate's version of an altered check. Its outcome sets no verdict.",
  },
  testFileChanged: {
    word: 'Test file changed',
    meaning:
      "The imported test's file differs from the base's. The candidate's file judges the test, and a failure is not a regression.",
  },
} as const;
