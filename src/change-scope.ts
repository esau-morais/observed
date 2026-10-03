import { Option, Schema } from 'effect';
import type {
  Anchor,
  ChangeScope,
  ChangedLines,
  GitChanges,
  Journey,
  LineRange,
  ScopeFile,
} from './comparison-model';
import { lineRangeSchema } from './comparison-model';
import { text } from './capture/model';
import { diffLines, lines } from './source-diff';

export const coverageSchemaVersion = 1;

// The evidence file the coverage collector writes. Replace with
// evidenceKinds.coverage.file once that kind is registered.
const coverageFileSchema = Schema.Struct({
  kind: Schema.Literal('coverage'),
  schemaVersion: Schema.Literal(coverageSchemaVersion),
  value: Schema.Struct({
    files: Schema.Array(
      Schema.Struct({
        path: text,
        executed: Schema.Array(lineRangeSchema),
        unexecuted: Schema.Array(lineRangeSchema),
      }),
    ),
    scripts: Schema.Array(
      Schema.Union([
        Schema.Struct({
          script: text,
          kind: Schema.Literal('mapped'),
          files: Schema.Array(text),
          excluded: Schema.Array(Schema.Struct({ path: text, reason: text })),
        }),
        Schema.Struct({
          script: text,
          kind: Schema.Literal('unavailable'),
          reason: text,
        }),
      ]),
    ),
  }),
});

type FileCoverage = {
  executed: readonly LineRange[];
  unexecuted: readonly LineRange[];
};

// One journey's candidate coverage, keyed by path relative to the project.
// `excluded` holds files a source map named whose lines could not be used,
// and `unmapped` the reasons scripts could not be mapped to source files.
export type CoverageRecord =
  | {
      kind: 'recorded';
      files: ReadonlyMap<string, FileCoverage>;
      excluded: ReadonlyMap<string, string>;
      unmapped: readonly string[];
    }
  | { kind: 'unavailable'; reason: string };

export function parseCoverage(input: string): CoverageRecord {
  const decoded = Schema.decodeUnknownOption(
    Schema.fromJsonString(coverageFileSchema),
  )(input);

  return Option.match(decoded, {
    onNone: () => ({
      kind: 'unavailable',
      reason: `The coverage file is malformed or not schema version ${coverageSchemaVersion}`,
    }),
    onSome: ({ value }) => ({
      kind: 'recorded',
      files: new Map(
        value.files.map((entry) => [
          entry.path,
          { executed: entry.executed, unexecuted: entry.unexecuted },
        ]),
      ),
      excluded: new Map(
        value.scripts.flatMap((script) =>
          script.kind === 'mapped'
            ? script.excluded.map(
                (entry) => [entry.path, entry.reason] as const,
              )
            : [],
        ),
      ),
      unmapped: value.scripts.flatMap((script) =>
        script.kind === 'unavailable' ? [script.reason] : [],
      ),
    }),
  });
}

export type ScopeJourney = {
  journey: Journey;
  sources: {
    base: { files: ReadonlyMap<string, string> } | null;
    candidate: { files: ReadonlyMap<string, string> } | null;
  };
  coverage: CoverageRecord;
};

export const reasons = {
  preview: 'A preview has no base revision to compare with.',
  noSnapshots:
    'No journey has source snapshots of both the base and the candidate.',
  differentSnapshots:
    'The journeys captured different source snapshots, so no single set of changed files applies.',
  recipe: 'Recipe comparison is not implemented in this version',
  fileType: 'No collector runs this file type.',
  noCoverage:
    'No journey recorded coverage, so no evidence shows that this file ran.',
  notInCoverage: 'Coverage recorded no execution of this file.',
  noChangedLineRan: 'No changed line ran in a journey that recorded coverage.',
  onlyRemoved:
    'The change only removes lines, and coverage cannot show that removed lines ran.',
  linesUnknown:
    'The source snapshots could not be read, so the changed lines are unknown.',
  removed: 'No evidence points at this removed file.',
  outside: 'Neither source snapshot contains this file.',
} as const;

// Files a browser or JavaScript server runtime executes. Coverage of a file
// overrides this list, since a source map can name any original file.
const runnable = /\.(?:[cm]?[jt]sx?|vue|svelte)$/;
const declaration = /\.d\.[cm]?ts$/;

function collectorRuns(path: string): boolean {
  return runnable.test(path) && !declaration.test(path);
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function ranges(numbers: Iterable<number>): LineRange[] {
  const sorted = unique(numbers).sort((left, right) => left - right);
  const result: [number, number][] = [];

  for (const line of sorted) {
    const last = result.at(-1);

    if (last !== undefined && last[1] === line - 1) {
      last[1] = line;
    } else {
      result.push([line, line]);
    }
  }

  return result;
}

function within(line: number, list: readonly LineRange[]): boolean {
  return list.some(([start, end]) => start <= line && line <= end);
}

// Candidate line numbers that the change added, or null when the snapshots
// cannot be read or the diff is too large.
function addedLines(
  path: string,
  change: ScopeFile['change'],
  base: ReadonlyMap<string, string> | null,
  candidate: ReadonlyMap<string, string> | null,
): number[] | null {
  const after = candidate?.get(path);

  if (change === 'removed' || after === undefined) {
    return change === 'removed' ? [] : null;
  }

  if (change === 'added') {
    return lines(after).map((_, index) => index + 1);
  }

  const before = base?.get(path);
  const diff = before === undefined ? null : diffLines(before, after);

  return diff === null
    ? null
    : diff.candidate.flatMap((kind, index) =>
        kind === 'added' ? [index + 1] : [],
      );
}

type Anchored = { journey: string; checks: readonly string[]; anchor: Anchor };

function anchorsOn(journeys: readonly ScopeJourney[], path: string) {
  const found: Anchored[] = [];

  for (const { journey } of journeys) {
    for (const finding of journey.findings) {
      if (finding.location.kind !== 'anchored') {
        continue;
      }

      for (const anchor of finding.location.anchors) {
        if (anchor.path === path) {
          found.push({
            journey: journey.title,
            checks: finding.checks,
            anchor,
          });
        }
      }
    }
  }

  return found;
}

function fromAnchors(
  identity: Pick<ScopeFile, 'path' | 'change'>,
  anchored: readonly Anchored[],
  basis: Anchor['basis'],
  relation: 'checked' | 'exercised',
): ScopeFile | null {
  const [first, ...rest] = unique(anchored.map((item) => item.journey));

  if (first === undefined) {
    return null;
  }

  const checks = unique(anchored.flatMap((item) => item.checks));
  const [firstCheck, ...otherChecks] = checks;

  if (relation === 'checked') {
    return firstCheck === undefined || basis === 'diff-name-match'
      ? null
      : {
          ...identity,
          captured: true,
          relation,
          basis,
          journeys: [first, ...rest],
          checks: [firstCheck, ...otherChecks],
        };
  }

  return {
    ...identity,
    captured: true,
    relation,
    basis,
    journeys: [first, ...rest],
    checks,
  };
}

function capturedFile(
  identity: Pick<ScopeFile, 'path' | 'change'>,
  journeys: readonly ScopeJourney[],
  sources: ScopeJourney['sources'] | null,
): ScopeFile {
  const anchored = anchorsOn(journeys, identity.path);
  const strong = anchored.filter(
    (item) => item.anchor.basis !== 'diff-name-match',
  );
  const [checkedAnchor] = strong.filter((item) => item.checks.length > 0);

  if (checkedAnchor !== undefined) {
    const checked = fromAnchors(
      identity,
      strong.filter((item) => item.checks.length > 0),
      checkedAnchor.anchor.basis,
      'checked',
    );

    if (checked !== null) {
      return checked;
    }
  }

  const changed = addedLines(
    identity.path,
    identity.change,
    sources?.base?.files ?? null,
    sources?.candidate?.files ?? null,
  );
  const covering = journeys.flatMap(({ journey, coverage }) => {
    const file =
      coverage.kind === 'recorded'
        ? coverage.files.get(identity.path)
        : undefined;

    return file === undefined ? [] : [{ journey: journey.title, file }];
  });
  let covered: ScopeFile | null = null;

  if (covering.length > 0 && changed !== null && changed.length > 0) {
    const ran = changed.filter((line) =>
      covering.some(({ file }) => within(line, file.executed)),
    );
    const notRan = changed.filter(
      (line) =>
        !ran.includes(line) &&
        covering.some(({ file }) => within(line, file.unexecuted)),
    );
    const lines: ChangedLines = { ran: ranges(ran), notRan: ranges(notRan) };
    const ranIn = unique(
      covering
        .filter(({ file }) => ran.some((line) => within(line, file.executed)))
        .map((item) => item.journey),
    );
    const [first, ...rest] = ranIn;
    const [listedFirst, ...listedRest] = unique(
      covering.map((item) => item.journey),
    );

    if (first !== undefined) {
      return {
        ...identity,
        captured: true,
        relation: 'exercised',
        basis: 'coverage',
        lines,
        journeys: [first, ...rest],
        checks: [],
      };
    }

    if (listedFirst !== undefined) {
      covered = {
        ...identity,
        captured: true,
        relation: 'not-observed',
        basis: 'coverage',
        lines,
        reason: reasons.noChangedLineRan,
        journeys: [listedFirst, ...listedRest],
        checks: [],
      };
    }
  }

  const [weakAnchor] = strong;
  const weak =
    weakAnchor === undefined
      ? null
      : fromAnchors(identity, strong, weakAnchor.anchor.basis, 'exercised');

  if (weak !== null) {
    return weak;
  }

  const matched = anchored.filter(
    (item) => item.anchor.basis === 'diff-name-match',
  );
  const match =
    matched.length === 0
      ? null
      : fromAnchors(identity, matched, 'diff-name-match', 'exercised');

  if (match !== null) {
    return match;
  }

  if (covered !== null) {
    return covered;
  }

  const excludedReason = journeys
    .map(({ coverage }) =>
      coverage.kind === 'recorded'
        ? coverage.excluded.get(identity.path)
        : undefined,
    )
    .find((value) => value !== undefined);
  const unmappedReason = journeys
    .flatMap(({ coverage }) =>
      coverage.kind === 'recorded' ? coverage.unmapped : [],
    )
    .at(0);
  let reason: string;

  if (identity.change === 'removed') {
    reason = reasons.removed;
  } else if (covering.length > 0) {
    reason = changed === null ? reasons.linesUnknown : reasons.onlyRemoved;
  } else if (excludedReason !== undefined) {
    reason = `Coverage could not map this file's lines: ${excludedReason}`;
  } else if (!collectorRuns(identity.path)) {
    reason = reasons.fileType;
  } else if (unmappedReason !== undefined) {
    reason = `Coverage could not map a script to source files, so no evidence shows whether this file ran: ${unmappedReason}`;
  } else if (journeys.some(({ coverage }) => coverage.kind === 'recorded')) {
    reason = reasons.notInCoverage;
  } else {
    reason = reasons.noCoverage;
  }

  return {
    ...identity,
    captured: true,
    relation: 'not-observed',
    basis: 'none',
    reason,
    journeys: [],
    checks: [],
  };
}

function snapshotPair(journey: Journey) {
  const base = journey.base.capture?.manifest.source;
  const candidate = journey.candidate.capture?.manifest.source;

  return base === undefined || candidate === undefined
    ? null
    : { base, candidate };
}

// The changed files of a comparison and what evidence touched each one.
// Relations come only from the journeys' recorded findings and coverage.
export function changeScope({
  mode,
  journeys,
  changes,
}: {
  mode: 'preview' | 'comparison';
  journeys: readonly ScopeJourney[];
  changes: GitChanges;
}): ChangeScope {
  if (mode === 'preview') {
    return { kind: 'unavailable', reason: reasons.preview };
  }

  const paired = journeys.flatMap((item) => {
    const pair = snapshotPair(item.journey);

    return pair === null ? [] : [{ ...item, pair }];
  });
  const [first] = paired;

  if (first === undefined) {
    return { kind: 'unavailable', reason: reasons.noSnapshots };
  }

  if (
    paired.some(
      ({ pair }) =>
        pair.base.sha256 !== first.pair.base.sha256 ||
        pair.candidate.sha256 !== first.pair.candidate.sha256,
    )
  ) {
    return { kind: 'unavailable', reason: reasons.differentSnapshots };
  }

  const before = new Map(
    first.pair.base.files.map((file) => [file.path, file.sha256]),
  );
  const after = new Map(
    first.pair.candidate.files.map((file) => [file.path, file.sha256]),
  );
  const identities: Pick<ScopeFile, 'path' | 'change'>[] = [];

  for (const path of unique([...before.keys(), ...after.keys()])) {
    const base = before.get(path);
    const candidate = after.get(path);

    if (base === candidate) {
      continue;
    }

    let change: ScopeFile['change'] = 'modified';

    if (base === undefined) {
      change = 'added';
    } else if (candidate === undefined) {
      change = 'removed';
    }

    identities.push({ path, change });
  }

  const sources =
    paired.find(
      ({ sources: read }) => read.base !== null && read.candidate !== null,
    )?.sources ?? null;
  const files: ScopeFile[] = identities.map((identity) =>
    capturedFile(identity, journeys, sources),
  );

  if (changes.kind === 'listed') {
    for (const change of changes.files) {
      if (
        !before.has(change.path) &&
        !after.has(change.path) &&
        !files.some((file) => file.path === change.path)
      ) {
        files.push({
          ...change,
          captured: false,
          relation: 'outside-captured-source',
          basis: 'none',
          reason: reasons.outside,
          journeys: [],
          checks: [],
        });
      }
    }
  }

  return {
    kind: 'recorded',
    sources: {
      base: first.pair.base.sha256,
      candidate: first.pair.candidate.sha256,
    },
    files: files.sort((left, right) =>
      left.path < right.path ? -1 : Number(left.path > right.path),
    ),
    outside:
      changes.kind === 'listed'
        ? { kind: 'listed' }
        : { kind: 'unavailable', reason: changes.reason },
    coverage: journeys.map(({ journey, coverage }) =>
      coverage.kind === 'recorded'
        ? { journey: journey.title, kind: 'recorded' }
        : {
            journey: journey.title,
            kind: 'unavailable',
            reason: coverage.reason,
          },
    ),
    recipe: { kind: 'unavailable', reason: reasons.recipe },
  };
}
