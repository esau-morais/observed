import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { gitChanges } from '../src/capture/changed-files';
import {
  changeScope,
  parseCoverage,
  type CoverageRecord,
  type ScopeJourney,
} from '../src/change-scope';
import {
  capturedFiles,
  scopeFileLines,
  scopeLine,
} from '../src/change-scope-text';
import {
  comparisonSchema,
  resultVersionProblem,
  type ChangeScope,
  type Finding,
  type GitChanges,
  type Journey,
  type ScopeFile,
  type Side,
} from '../src/comparison-model';
import { renderComparison } from '../src/comparison-report';
import { headline, runTone } from '../src/result-text';
import { sha256 } from '../src/encoding';

const fixture = await readFile(
  path.join(import.meta.dirname, 'fixtures/report/errors-result.json'),
  'utf8',
);
const result = Schema.decodeUnknownSync(
  Schema.fromJsonString(comparisonSchema),
)(fixture);
const [recorded] = result.journeys;

type Files = Record<string, string>;

function withSource(side: Side, files: Files): Side {
  if (side.capture === null) {
    throw new Error('The fixture sides have captures');
  }

  const manifest = side.capture.manifest;
  const records = Object.entries(files).map(([file, content]) => ({
    path: file,
    sha256: sha256(content),
  }));
  const [first, ...rest] = records;

  if (first === undefined) {
    throw new Error('A snapshot has at least one file');
  }

  return {
    ...side,
    capture: {
      ...side.capture,
      manifest: {
        ...manifest,
        source: {
          ...manifest.source,
          sha256: sha256(JSON.stringify(records)),
          files: [first, ...rest],
        },
      },
    },
  };
}

const noCoverage: CoverageRecord = {
  kind: 'unavailable',
  reason: 'The capture recorded no coverage',
};

const gitUnavailable: GitChanges = {
  kind: 'unavailable',
  reason: 'Not listed in this test',
};

function scenario(
  base: Files,
  candidate: Files,
  options: {
    findings?: Finding[];
    coverage?: CoverageRecord;
  } = {},
): ScopeJourney {
  const journey: Journey = {
    ...recorded,
    base: withSource(recorded.base, base),
    candidate: withSource(recorded.candidate, candidate),
    findings: options.findings ?? [],
  };

  return {
    journey,
    sources: {
      base: { files: new Map(Object.entries(base)) },
      candidate: { files: new Map(Object.entries(candidate)) },
    },
    coverage: options.coverage ?? noCoverage,
  };
}

const recipeUnavailable = {
  kind: 'unavailable',
  reason: 'Not read in this test',
} as const;

function scope(
  journeys: ScopeJourney[],
  changes: GitChanges = gitUnavailable,
): Extract<ChangeScope, { kind: 'recorded' }> {
  const computed = changeScope({
    mode: 'comparison',
    journeys,
    changes,
    recipe: recipeUnavailable,
  });

  if (computed.kind !== 'recorded') {
    throw new Error(`Expected a recorded scope: ${computed.reason}`);
  }

  return computed;
}

function file(computed: { files: readonly ScopeFile[] }, name: string) {
  const found = computed.files.find((item) => item.path === name);

  if (found === undefined) {
    throw new Error(`${name} is not in the scope`);
  }

  return found;
}

function anchoredFinding(
  name: string,
  basis: 'stack-frame' | 'diff-name-match',
  checks: string[],
): Finding {
  return {
    id: `finding-${basis}-${checks.length}`,
    evidence: 'browser-errors',
    checks,
    subject: 'TypeError thrown',
    comparison: 'new',
    location: {
      kind: 'anchored',
      anchors: [
        {
          path: name,
          line: 2,
          side: 'candidate',
          basis,
          evidence: 'Synthetic anchor for this test',
          artifacts: [],
          diff: 'added',
        },
      ],
    },
  };
}

// The evidence file in the shape the coverage collector writes.
function coverageFile(
  files: { path: string; executed: number[][]; unexecuted: number[][] }[],
  excluded: { path: string; reason: string }[] = [],
): string {
  return JSON.stringify({
    kind: 'coverage',
    schemaVersion: 1,
    value: {
      files,
      scripts: [
        {
          script: 'http://127.0.0.1:4010/assets/index.js',
          kind: 'mapped',
          files: files.map((file) => file.path),
          excluded,
        },
      ],
    },
  });
}

function coverageOf(
  name: string,
  executed: [number, number][],
  unexecuted: [number, number][],
): CoverageRecord {
  return parseCoverage(coverageFile([{ path: name, executed, unexecuted }]));
}

const app = 'export function load() {\n  return 1;\n}\n';
const changedApp = 'export function load() {\n  return 2;\n}\n';

test('lists added, removed and modified files and leaves out unchanged ones', () => {
  const computed = scope([
    scenario(
      { 'keep.ts': 'same\n', 'gone.ts': 'old\n', 'app.ts': app },
      { 'keep.ts': 'same\n', 'new.ts': 'new\n', 'app.ts': changedApp },
    ),
  ]);

  expect(computed.files.map((item) => [item.path, item.change])).toEqual([
    ['app.ts', 'modified'],
    ['gone.ts', 'removed'],
    ['new.ts', 'added'],
  ]);
});

test('a changed file that neither snapshot holds is outside the captured source', () => {
  const computed = scope(
    [scenario({ 'app.ts': app }, { 'app.ts': changedApp })],
    {
      kind: 'listed',
      projectDirectory: '.',
      files: [
        { path: 'app.ts', change: 'modified' },
        { path: 'README.md', change: 'modified' },
      ],
    },
  );

  expect(computed.files.map((item) => [item.path, item.relation])).toEqual([
    ['README.md', 'outside-captured-source'],
    ['app.ts', 'not-observed'],
  ]);
  expect(file(computed, 'README.md').captured).toBe(false);
});

test('a preview or a missing base snapshot has no change scope', () => {
  const journey = scenario({ 'app.ts': app }, { 'app.ts': changedApp });
  const withoutBase: ScopeJourney = {
    ...journey,
    journey: {
      ...journey.journey,
      base: {
        execution: 'unavailable',
        capture: null,
        recipe: null,
        screenshot: null,
        checks: [],
        artifacts: [],
        unresolved: ['Base capture unavailable'],
      },
    },
  };

  expect(
    changeScope({
      mode: 'comparison',
      journeys: [withoutBase],
      changes: gitUnavailable,
      recipe: recipeUnavailable,
    }).kind,
  ).toBe('unavailable');
  expect(
    changeScope({
      mode: 'preview',
      journeys: [journey],
      changes: gitUnavailable,
      recipe: recipeUnavailable,
    }).kind,
  ).toBe('unavailable');
});

test('an anchor on a finding with a check makes the file checked, and without one exercised', () => {
  const pair = [{ 'app.ts': app }, { 'app.ts': changedApp }] as const;
  const checked = file(
    scope([
      scenario(...pair, {
        findings: [anchoredFinding('app.ts', 'stack-frame', ['no-errors'])],
      }),
    ]),
    'app.ts',
  );
  const unchecked = file(
    scope([
      scenario(...pair, {
        findings: [anchoredFinding('app.ts', 'stack-frame', [])],
      }),
    ]),
    'app.ts',
  );

  expect([checked.relation, checked.basis, checked.checks]).toEqual([
    'checked',
    'stack-frame',
    ['no-errors'],
  ]);
  expect([unchecked.relation, unchecked.basis]).toEqual([
    'exercised',
    'stack-frame',
  ]);
});

test('a name match is at most exercised, even on a finding with a check', () => {
  const matched = file(
    scope([
      scenario(
        { 'app.ts': app },
        { 'app.ts': changedApp },
        {
          findings: [
            anchoredFinding('app.ts', 'diff-name-match', ['no-errors']),
          ],
        },
      ),
    ]),
    'app.ts',
  );

  expect([matched.relation, matched.basis]).toEqual([
    'exercised',
    'diff-name-match',
  ]);
});

test('coverage of a changed line makes the file exercised, with the lines that ran', () => {
  const covered = file(
    scope([
      scenario(
        { 'app.ts': app },
        { 'app.ts': changedApp },
        { coverage: coverageOf('app.ts', [[1, 3]], []) },
      ),
    ]),
    'app.ts',
  );

  expect(covered).toMatchObject({
    relation: 'exercised',
    basis: 'coverage',
    lines: { ran: [[2, 2]], notRan: [] },
  });
});

test('coverage where the file ran but no changed line did leaves the file not observed', () => {
  const covered = file(
    scope([
      scenario(
        { 'app.ts': app },
        { 'app.ts': changedApp },
        {
          coverage: coverageOf(
            'app.ts',
            [
              [1, 1],
              [3, 3],
            ],
            [[2, 2]],
          ),
        },
      ),
    ]),
    'app.ts',
  );

  expect(covered).toMatchObject({
    relation: 'not-observed',
    basis: 'coverage',
    lines: { ran: [], notRan: [[2, 2]] },
  });
});

test('a stylesheet is not observed because no collector runs it', () => {
  const stylesheet = file(
    scope([
      scenario(
        { 'app.css': 'a { color: red; }\n' },
        { 'app.css': 'a { color: blue; }\n' },
        { coverage: coverageOf('other.ts', [[1, 1]], []) },
      ),
    ]),
    'app.css',
  );

  expect(stylesheet).toMatchObject({
    relation: 'not-observed',
    basis: 'none',
    reason: 'No collector runs this file type.',
  });
});

test('server code that no journey covers is not observed', () => {
  const server = file(
    scope([
      scenario(
        { 'server.ts': app, 'App.tsx': 'ui\n' },
        { 'server.ts': changedApp, 'App.tsx': 'ui\n' },
        { coverage: coverageOf('App.tsx', [[1, 1]], []) },
      ),
    ]),
    'server.ts',
  );

  expect(server).toMatchObject({ relation: 'not-observed', basis: 'none' });
  expect(server.relation === 'not-observed' && server.reason).toMatch(
    /coverage recorded no execution/i,
  );
});

test('a malformed coverage file is unavailable, not empty coverage', () => {
  expect(parseCoverage('{"schemaVersion":1,"files":[]}').kind).toBe(
    'unavailable',
  );
  expect(
    parseCoverage(
      coverageFile([{ path: 'a.ts', executed: [[3, 1]], unexecuted: [] }]),
    ).kind,
  ).toBe('unavailable');
  expect(
    parseCoverage(
      coverageFile([]).replace('"schemaVersion":1', '"schemaVersion":2'),
    ).kind,
  ).toBe('unavailable');
});

test('a script coverage could not map leaves files unknown, not unexecuted', () => {
  const unmapped = file(
    scope([
      scenario(
        { 'base.ts': app },
        { 'base.ts': changedApp },
        {
          coverage: parseCoverage(
            JSON.stringify({
              kind: 'coverage',
              schemaVersion: 1,
              value: {
                files: [],
                scripts: [
                  {
                    script: '/assets/index.js',
                    kind: 'unavailable',
                    reason: 'No source map',
                  },
                ],
              },
            }),
          ),
        },
      ),
    ]),
    'base.ts',
  );

  expect(unmapped.relation === 'not-observed' && unmapped.reason).toBe(
    'Coverage could not map a script to source files, so no evidence shows whether this file ran: No source map',
  );
});

test('an excluded stylesheet gives the exclusion, not the file type', () => {
  const stylesheet = file(
    scope([
      scenario(
        { 'app.css': 'a {}\n' },
        { 'app.css': 'b {}\n' },
        {
          coverage: parseCoverage(
            coverageFile([], [{ path: 'app.css', reason: 'Map copy differs' }]),
          ),
        },
      ),
    ]),
    'app.css',
  );

  expect(stylesheet.relation === 'not-observed' && stylesheet.reason).toBe(
    "Coverage could not map this file's lines: Map copy differs",
  );
});

test('a file whose lines coverage could not map says why, not that it never ran', () => {
  const unmapped = file(
    scope([
      scenario(
        { 'App.tsx': app },
        { 'App.tsx': changedApp },
        {
          coverage: parseCoverage(
            coverageFile(
              [],
              [
                {
                  path: 'App.tsx',
                  reason: "The source map's copy differs from the snapshot",
                },
              ],
            ),
          ),
        },
      ),
    ]),
    'App.tsx',
  );

  expect(unmapped).toMatchObject({ relation: 'not-observed', basis: 'none' });
  expect(unmapped.relation === 'not-observed' && unmapped.reason).toBe(
    "Coverage could not map this file's lines: The source map's copy differs from the snapshot",
  );
});

test('a docs-only change says no captured file changed and lists the outside file', () => {
  const computed = scope([scenario({ 'app.ts': app }, { 'app.ts': app })], {
    kind: 'listed',
    projectDirectory: '.',
    files: [{ path: 'docs/guide.md', change: 'modified' }],
  });
  const docsOnly = { ...result, changeScope: computed };

  expect(scopeLine(computed)).toBe(
    'No captured file changed. 1 file changed outside the captured source.',
  );
  expect(scopeFileLines(docsOnly)).toEqual([
    'docs/guide.md (modified): Outside the captured source. Neither source snapshot contains this file.',
  ]);
  expect(renderComparison(docsOnly)).toContain('No captured file changed');
});

test('with nothing changed at all, the checks describe unchanged behavior', () => {
  const computed = scope([scenario({ 'app.ts': app }, { 'app.ts': app })], {
    kind: 'listed',
    projectDirectory: '.',
    files: [],
  });

  expect(scopeLine(computed)).toBe(
    'No captured file changed, so the checks describe unchanged behavior.',
  );
});

test("a file absent from one journey's coverage is not called unexecuted when another journey has none", () => {
  const pair = [{ 'app.ts': app }, { 'app.ts': changedApp }] as const;
  const covered = scenario(...pair, {
    coverage: coverageOf('other.ts', [[1, 1]], []),
  });
  const uncovered = scenario(...pair);
  const partly = file(scope([covered, uncovered]), 'app.ts');

  expect(partly.relation === 'not-observed' && partly.reason).toBe(
    'Coverage recorded no execution of this file, and some journeys recorded no coverage.',
  );
});

test('a coverage file that lists a path twice is unavailable', () => {
  const entry = { path: 'app.ts', executed: [[1, 1]], unexecuted: [] };

  expect(parseCoverage(coverageFile([entry, entry])).kind).toBe('unavailable');
});

test('passing checks with a file not observed read as no regression in the named checks', () => {
  const mixed = scope(
    [
      scenario(
        { 'server.ts': app, 'App.tsx': app },
        { 'server.ts': changedApp, 'App.tsx': changedApp },
        {
          findings: [anchoredFinding('App.tsx', 'stack-frame', ['no-errors'])],
        },
      ),
    ],
    {
      kind: 'listed',
      projectDirectory: '.',
      files: [{ path: 'README.md', change: 'modified' }],
    },
  );
  const passing = {
    ...result,
    conclusion: {
      kind: 'no-regression' as const,
      text: 'One request per load action passed on base and candidate.',
    },
    changeScope: mixed,
  };
  const everyFileTouched = {
    ...passing,
    changeScope: scope([
      scenario(
        { 'App.tsx': app },
        { 'App.tsx': changedApp },
        {
          findings: [anchoredFinding('App.tsx', 'stack-frame', ['no-errors'])],
        },
      ),
    ]),
  };
  const regression = { ...result, changeScope: mixed };

  expect(headline(passing)).toBe(
    'No regression in the named checks: 1 changed file not observed',
  );
  expect(renderComparison(passing)).toContain(
    '**No regression in the named checks** · 1 changed file not observed',
  );
  expect(runTone(passing)).not.toBe('checked');
  expect(headline(everyFileTouched)).toBe(`No regression: ${result.title}`);
  expect(headline(regression)).toMatch(/^Regression: /);
});

test('a changed observed.json says why journey and check changes were not compared', () => {
  const computed = scope([scenario({ 'app.ts': app }, { 'app.ts': app })], {
    kind: 'listed',
    projectDirectory: '.',
    files: [{ path: 'observed.json', change: 'modified' }],
  });

  expect(scopeFileLines({ ...result, changeScope: computed })).toContain(
    'Changes to journeys and checks: Not read in this test.',
  );
});

test('the line counts each relation and says when outside names are unknown', () => {
  const computed = scope([
    scenario(
      { 'a.ts': app, 'b.css': 'a {}\n' },
      { 'a.ts': changedApp, 'b.css': 'b {}\n' },
      { findings: [anchoredFinding('a.ts', 'stack-frame', ['no-errors'])] },
    ),
  ]);

  expect(scopeLine(computed)).toBe(
    '2 captured files changed: 1 checked · 1 not observed. Files outside the captured source are unknown.',
  );
});

test('a result written under schema 7 asks for new captures', () => {
  expect(resultVersionProblem({ schemaVersion: 7 })).toMatch(
    /version 7 is unsupported.*Capture both revisions again/,
  );
  expect(resultVersionProblem(JSON.parse(fixture))).toBeNull();
});

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

// A project in a subdirectory once showed `../DESIGN.md` and project-relative
// paths; people read paths from the repository root.
test('Git lists working tree and untracked changes relative to the project directory, and people read them from the repository root', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-changes-'));
  directories.push(root);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, stdio: 'pipe' }).toString();

  git('init', '--quiet');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  git('config', 'diff.relative', 'true');
  await mkdir(path.join(root, 'app'));
  await writeFile(path.join(root, 'app/server.ts'), 'one\n');
  await writeFile(path.join(root, 'README.md'), 'readme\n');
  git('add', '.');
  git('-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'base');
  await writeFile(path.join(root, 'app/server.ts'), 'two\n');
  await writeFile(path.join(root, 'app/new.ts'), 'new\n');
  await writeFile(path.join(root, 'README.md'), 'changed\n');
  const transcripts = await mkdtemp(path.join(tmpdir(), 'observed-changes-'));
  directories.push(transcripts);

  const changes = await Effect.runPromise(
    gitChanges({
      projectRoot: path.join(root, 'app'),
      baseRevision: 'HEAD',
      candidateRevision: null,
      transcript: path.join(transcripts, 'changes.jsonl'),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  expect(changes).toEqual({
    kind: 'listed',
    projectDirectory: 'app',
    files: [
      { path: '../README.md', change: 'modified' },
      { path: 'new.ts', change: 'added' },
      { path: 'server.ts', change: 'modified' },
    ],
  });

  const computed = scope(
    [scenario({ 'server.ts': app }, { 'server.ts': changedApp })],
    changes,
  );
  const scoped = { ...result, changeScope: computed };

  expect(
    scopeFileLines(scoped)
      .slice(0, 3)
      .map((line) => line.split(' ')[0]),
  ).toEqual(['README.md', 'app/new.ts', 'app/server.ts']);
  expect(capturedFiles(scoped).map((item) => item.path)).toEqual([
    'app/server.ts',
  ]);
});

test('an unknown base revision leaves the outside names unavailable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-changes-'));
  directories.push(root);
  execFileSync('git', ['init', '--quiet'], { cwd: root });

  const changes = await Effect.runPromise(
    gitChanges({
      projectRoot: root,
      baseRevision: 'no-such-revision',
      candidateRevision: null,
      transcript: path.join(root, 'changes.jsonl'),
    }).pipe(Effect.provide(BunServices.layer)),
  );

  expect(changes.kind).toBe('unavailable');
});
