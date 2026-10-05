import {
  atOrAbove,
  compareAccessibility,
  defaultImpact,
} from './accessibility';
import type { CheckDefinition } from './checks';
import { ignoredBy, signature } from './checks/browser-errors';
import type {
  Anchor,
  CheckVerdict,
  Finding,
  Journey,
  Side,
} from './comparison-model';
import { sha256 } from './encoding';
import type { EvidenceKind, EvidenceValue } from './evidence-kinds';
import {
  renderChanges,
  renderCount,
  renderSubjectPrefix,
} from './evidence-kinds/react';
import { diffLines, lines, type FileDiff } from './source-diff';
import {
  applicationScript,
  originalPosition,
  snapshotPath,
  stackFrames,
  type SourceMap,
} from './source-map';

export type ScriptMap =
  | { kind: 'recorded'; map: SourceMap; artifact: string }
  | { kind: 'unavailable'; reason: string };

// One capture's verified source snapshot and fetched source maps.
export type SideSource = {
  files: ReadonlyMap<string, string>;
  maps:
    | {
        kind: 'recorded';
        origin: string;
        scripts: ReadonlyMap<string, ScriptMap>;
      }
    | { kind: 'unavailable'; reason: string };
};

type Located = Finding['location'];

const maxAnchors = 5;
const maxElements = 20;

const unanchored = (reason: string): Located => ({
  kind: 'unanchored',
  reason,
});

function findingId(evidence: string, key: string): string {
  return `${evidence}:${sha256(key).slice(0, 16)}`;
}

function escape(value: string): string {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A name is matched only where the diff defines it, never where it is merely
// used, so a common word cannot land on an unrelated line.
function definitionPattern(name: string): RegExp {
  const word = escape(name);

  return new RegExp(
    `(?:\\bfunction\\s*\\*?\\s*${word}\\s*[(<]|\\bclass\\s+${word}\\b|\\b(?:const|let|var)\\s+${word}\\s*(?::[^=]+)?=)`,
  );
}

type ChangedLine = {
  side: 'base' | 'candidate';
  path: string;
  line: number;
  text: string;
};

function sourceContext(base: SideSource | null, candidate: SideSource | null) {
  const diffs = new Map<string, FileDiff | null>();

  const diffFor = (path: string): FileDiff | null => {
    if (base === null || candidate === null) {
      return null;
    }

    if (!diffs.has(path)) {
      diffs.set(
        path,
        diffLines(base.files.get(path) ?? '', candidate.files.get(path) ?? ''),
      );
    }

    return diffs.get(path) ?? null;
  };

  const anchor = (
    fields: Omit<Anchor, 'diff' | 'artifacts'> & {
      artifacts?: readonly string[];
    },
  ): Anchor => ({
    ...fields,
    artifacts: fields.artifacts ?? [],
    diff: diffFor(fields.path)?.[fields.side][fields.line - 1] ?? 'unknown',
  });

  let changed: ChangedLine[] | null = null;

  const changedLines = (): ChangedLine[] => {
    if (changed !== null) {
      return changed;
    }

    const result: ChangedLine[] = [];

    for (const [side, source] of [
      ['base', base],
      ['candidate', candidate],
    ] as const) {
      for (const [path, content] of source?.files ?? []) {
        const diff = diffFor(path);

        for (const [index, text] of lines(content).entries()) {
          const change = diff?.[side][index];

          if (change === 'added' || change === 'removed') {
            result.push({ side, path, line: index + 1, text });
          }
        }
      }
    }

    changed = result;

    return result;
  };

  return { anchor, changedLines, comparable: base !== null };
}

type Context = ReturnType<typeof sourceContext>;

type Resolved =
  | { kind: 'resolved'; path: string; line: number; artifact: string }
  | { kind: 'failed'; reason: string };

function resolveScript(
  source: SideSource,
  script: string,
  line: number,
  column: number,
): Resolved {
  if (source.maps.kind === 'unavailable') {
    return { kind: 'failed', reason: source.maps.reason };
  }

  const entry = source.maps.scripts.get(script);

  if (entry === undefined) {
    return {
      kind: 'failed',
      reason: `No source map was fetched for ${script}`,
    };
  }

  if (entry.kind === 'unavailable') {
    return { kind: 'failed', reason: entry.reason };
  }

  const position = originalPosition(entry.map, line, column);

  if (position === null) {
    return {
      kind: 'failed',
      reason: `The source map of ${script} maps nothing at ${line}:${column}`,
    };
  }

  const path = snapshotPath(position.source, new Set(source.files.keys()));

  if (path === null) {
    return {
      kind: 'failed',
      reason: `${script}:${line}:${column} maps to ${position.source}, outside the captured source`,
    };
  }

  // A map built from other code would place the line wrongly.
  return position.content !== null &&
    position.content !== source.files.get(path)
    ? {
        kind: 'failed',
        reason: `The source map's copy of ${path} differs from the snapshot`,
      }
    : {
        kind: 'resolved',
        path,
        line: position.line,
        artifact: entry.artifact,
      };
}

// The single candidate line that defines the name, if the diff added one.
function definedOnAddedLine(
  context: Context,
  name: string,
  evidence: string,
): Anchor | null {
  if (name.length < 3) {
    return null;
  }

  const pattern = definitionPattern(name);
  const matches = context
    .changedLines()
    .filter((line) => line.side === 'candidate' && pattern.test(line.text));
  const [only] = matches;

  return matches.length === 1 && only !== undefined
    ? context.anchor({
        path: only.path,
        line: only.line,
        side: 'candidate',
        basis: 'diff-name-match',
        evidence,
      })
    : null;
}

// The single changed line on either side that contains the token.
function onChangedLine(
  context: Context,
  test: (text: string) => boolean,
  evidence: string,
): Anchor | null {
  const matches = context.changedLines().filter((line) => test(line.text));
  const [only] = matches;

  return matches.length === 1 && only !== undefined
    ? context.anchor({
        path: only.path,
        line: only.line,
        side: only.side,
        basis: 'diff-name-match',
        evidence,
      })
    : null;
}

function located(anchors: readonly Anchor[], reason: string): Located {
  const unique = anchors.filter(
    (anchor, index) =>
      anchors.findIndex(
        (other) =>
          other.side === anchor.side &&
          other.path === anchor.path &&
          other.line === anchor.line,
      ) === index,
  );
  const [first, ...rest] = unique.slice(0, maxAnchors);

  return first === undefined
    ? unanchored(reason)
    : { kind: 'anchored', anchors: [first, ...rest] };
}

function recorded<K extends EvidenceKind>(
  side: Side | null,
  kind: K,
): EvidenceValue<K> | null {
  if (side === null || side.execution === 'unavailable') {
    return null;
  }

  for (const view of side.evidence) {
    if (view.kind === kind && view.status === 'recorded') {
      return view.value;
    }
  }

  return null;
}

function definitions<K extends CheckDefinition['kind']>(
  side: Side,
  kind: K,
): Extract<CheckDefinition, { kind: K }>[] {
  return (side.recipe?.checks ?? []).filter(
    (check): check is Extract<CheckDefinition, { kind: K }> =>
      check.kind === kind,
  );
}

type Input = {
  journey: Omit<Journey, 'findings'>;
  base: Side | null;
  context: Context;
  candidateSource: SideSource | null;
};

const errorName = /^(?:Uncaught )?([A-Z][A-Za-z]*(?:Error|Exception))\b/;

function errorFindings({
  journey,
  base,
  context,
  candidateSource,
}: Input): Finding[] {
  const record = recorded(journey.candidate, 'browser-errors');

  if (record === null) {
    return [];
  }

  const baseRecord = recorded(base, 'browser-errors');
  const known = new Set(baseRecord?.entries.map(signature) ?? []);
  const checks = definitions(journey.candidate, 'browser-errors');
  const baselineChecks = definitions(
    journey.candidate,
    'baseline-browser-errors',
  );
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const entry of record.entries) {
    const key = signature(entry);

    if ((entry.step === null && baselineChecks.length === 0) || seen.has(key)) {
      continue;
    }

    seen.add(key);

    const name = errorName.exec(entry.text)?.[1];
    const frames = stackFrames(entry.text);
    const anchors: Anchor[] = [];
    const reasons = new Set<string>();

    for (const [index, frame] of frames.entries()) {
      const script =
        candidateSource?.maps.kind === 'recorded'
          ? applicationScript(frame.url, candidateSource.maps.origin)
          : null;

      if (candidateSource === null) {
        reasons.add('The candidate source snapshot is unavailable');
        continue;
      }

      if (script === null) {
        reasons.add(
          candidateSource.maps.kind === 'unavailable'
            ? candidateSource.maps.reason
            : 'A frame is outside the application origin',
        );
        continue;
      }

      const resolved = resolveScript(
        candidateSource,
        script,
        frame.line,
        frame.column,
      );

      if (resolved.kind === 'failed') {
        reasons.add(resolved.reason);
        continue;
      }

      anchors.push(
        context.anchor({
          path: resolved.path,
          line: resolved.line,
          side: 'candidate',
          basis: 'stack-frame',
          evidence: `Stack frame ${index + 1} at ${script}:${frame.line}:${frame.column}, resolved by its source map.`,
          artifacts: [resolved.artifact],
        }),
      );
    }

    if (anchors.length === 0) {
      for (const frame of frames) {
        const match =
          frame.name === null
            ? null
            : definedOnAddedLine(
                context,
                frame.name,
                `A stack frame names ${frame.name}, which this added line defines.`,
              );

        if (match !== null) {
          anchors.push(match);
          break;
        }
      }
    }

    findings.push({
      id: findingId('browser-errors', key),
      evidence: 'browser-errors',
      checks: [
        ...checks.filter(
          (check) => entry.step !== null && !ignoredBy(check, entry),
        ),
        ...baselineChecks,
      ].map((check) => check.id),
      subject: errorSubject(entry.source, name),
      comparison: baseline(baseRecord !== null, known.has(key)),
      location: located(
        anchors,
        frames.length === 0
          ? 'The error has no stack frames'
          : [...reasons, 'no frame function is defined on an added line'].join(
              '; ',
            ),
      ),
    });
  }

  return findings;
}

function sourceProblem(
  name: string,
  reported: boolean,
  resolved: Resolved | null,
): string {
  if (!reported) {
    return `React DevTools reported no source for ${name}`;
  }

  return resolved?.kind === 'failed'
    ? resolved.reason
    : 'The candidate source snapshot is unavailable';
}

function errorSubject(
  source: 'page' | 'console',
  name: string | undefined,
): string {
  if (name !== undefined) {
    return `${name} thrown`;
  }

  return source === 'page' ? 'Uncaught page error' : 'Console error';
}

function renderSubject(
  name: string,
  change: { base: number; candidate: number } | undefined,
  count: number | null,
): string {
  const prefix = renderSubjectPrefix(name);

  if (change !== undefined) {
    return `${prefix}s ${change.base} → ${change.candidate}`;
  }

  return count === null ? `${prefix} count unknown` : `${prefix}s ${count}`;
}

// Whether the base had the same finding, when it was recorded at all.
function baseline(
  baseRecorded: boolean,
  onBase: boolean,
): Finding['comparison'] {
  if (!baseRecorded) {
    return 'no-baseline';
  }

  return onBase ? 'persisting' : 'new';
}

const failing = (verdict: CheckVerdict) =>
  verdict.verdict === 'regression' ||
  verdict.verdict === 'failed' ||
  verdict.verdict === 'unknown';

function reactFindings({
  journey,
  base,
  context,
  candidateSource,
}: Input): Finding[] {
  const candidate = recorded(journey.candidate, 'react');

  if (candidate === null) {
    return [];
  }

  const before = recorded(base, 'react');
  const changes = before === null ? [] : renderChanges(before, candidate);
  const checks = definitions(journey.candidate, 'react-renders');
  const failed = new Set(
    journey.checks.filter(failing).map((verdict) => verdict.id),
  );
  const names = [
    ...new Set([
      ...changes.map((change) => change.name),
      ...checks
        .filter((check) => failed.has(check.id))
        .map((check) => check.component),
    ]),
  ].filter((name) => name !== 'Anonymous');

  return names.map((name): Finding => {
    const change = changes.find((item) => item.name === name);
    const count = renderCount(candidate, name);
    const source = candidate.sources.find((item) => item.component === name);
    const resolved =
      source === undefined || candidateSource === null
        ? null
        : resolveScript(
            candidateSource,
            source.script,
            source.line,
            source.column,
          );
    const anchor =
      resolved?.kind === 'resolved' && source !== undefined
        ? context.anchor({
            path: resolved.path,
            line: resolved.line,
            side: 'candidate',
            basis: 'component-source',
            evidence: `React DevTools located ${name} at ${source.script}:${source.line}:${source.column}, resolved by its source map.`,
            artifacts: [resolved.artifact],
          })
        : definedOnAddedLine(
            context,
            name,
            `This added line defines the component ${name}.`,
          );

    return {
      id: findingId('react', name),
      evidence: 'react',
      checks: checks
        .filter((check) => check.component === name)
        .map((check) => check.id),
      subject: renderSubject(name, change, count),
      comparison:
        change === undefined ? baseline(before !== null, true) : 'changed',
      location:
        anchor === null
          ? unanchored(
              [
                sourceProblem(name, source !== undefined, resolved),
                `no added line defines ${name}`,
              ].join('; '),
            )
          : { kind: 'anchored', anchors: [anchor] },
    };
  });
}

const idSelector = /#([A-Za-z_][\w-]*)/g;
const idAttribute = /\bid=["']([^"']+)["']/;

function accessibilityFindings({ journey, base, context }: Input): Finding[] {
  const candidate = recorded(journey.candidate, 'accessibility');
  const before = recorded(base, 'accessibility');

  if (candidate === null || before === null) {
    return [];
  }

  const checks = definitions(journey.candidate, 'accessibility');

  return compareAccessibility(before, candidate)
    .flatMap((rule) =>
      rule.elements.flatMap((element) =>
        element.status === 'new' ? [{ rule, node: element.candidate }] : [],
      ),
    )
    .slice(0, maxElements)
    .map(({ rule, node }): Finding => {
      const ids = new Set([
        ...node.target.flatMap((part) =>
          [...(typeof part === 'string' ? [part] : part)].flatMap((selector) =>
            [...selector.matchAll(idSelector)].map((match) => match[1] ?? ''),
          ),
        ),
        ...[idAttribute.exec(node.html)?.[1] ?? ''],
      ]);
      ids.delete('');
      const opening = /^<[^>]+>/.exec(node.html.trim())?.[0];
      const anchor =
        [...ids]
          .map((id) =>
            onChangedLine(
              context,
              (text) => new RegExp(`(["'\`])${escape(id)}\\1`).test(text),
              `The element's id "${id}" appears on this changed line.`,
            ),
          )
          .find((match) => match !== null) ??
        (opening === undefined
          ? null
          : onChangedLine(
              context,
              (text) => text.includes(opening),
              "The element's markup appears on this changed line.",
            ));

      return {
        id: findingId(
          'accessibility',
          JSON.stringify([rule.rule, node.target, node.html]),
        ),
        evidence: 'accessibility',
        checks: checks
          .filter((check) =>
            atOrAbove(rule.impact, check.impact ?? defaultImpact),
          )
          .map((check) => check.id),
        subject: `New ${rule.rule} violation (${rule.impact})`,
        comparison: 'new',
        location:
          anchor === null
            ? unanchored(
                "Neither the element's id nor its markup appears on exactly one changed line",
              )
            : { kind: 'anchored', anchors: [anchor] },
      };
    });
}

function playwrightFindings({ journey, base, context }: Input): Finding[] {
  const candidate = recorded(journey.candidate, 'playwright');

  if (candidate === null) {
    return [];
  }

  const before = recorded(base, 'playwright');
  const files =
    journey.candidate.capture?.manifest.source.files.map((file) => file.path) ??
    [];

  return candidate.tests
    .filter((test) => test.outcome === 'unexpected' || test.outcome === 'flaky')
    .map((test): Finding => {
      const previous = before?.tests.find((item) => item.id === test.id);
      const inside = test.source !== null && files.includes(test.source);

      return {
        id: findingId('playwright', test.id),
        evidence: 'playwright',
        checks: [`playwright: ${test.id}`],
        subject:
          test.outcome === 'flaky'
            ? 'Playwright test flaky'
            : 'Playwright test failed',
        comparison: baseline(
          previous !== undefined && previous.outcome !== 'skipped',
          previous?.outcome !== 'expected',
        ),
        location:
          inside && test.source !== null && test.line > 0
            ? {
                kind: 'anchored',
                anchors: [
                  context.anchor({
                    path: test.source,
                    line: test.line,
                    side: 'candidate',
                    basis: 'test-location',
                    evidence: `Playwright's report places the test at ${test.file}:${test.line}.`,
                  }),
                ],
              }
            : unanchored(
                test.source === null
                  ? `Playwright's report places the test at ${test.file}, outside the captured app`
                  : `${test.source} is outside the captured source paths`,
              ),
      };
    });
}

const unlocatable: Partial<Record<CheckDefinition['kind'], string>> = {
  performance:
    'Performance samples time the page and its steps as a whole; they carry no source location',
  'api-status': 'An API response carries no source location',
  'api-schema': 'An API response carries no source location',
  'api-readback': 'An API response carries no source location',
  text: 'Rendered text carries no source location',
};

// Checks whose evidence has no finding of its own: one finding per failing
// or unknown verdict.
function checkFindings({ journey, base, context }: Input): Finding[] {
  const recipe = journey.candidate.recipe?.checks ?? [];

  return journey.checks.filter(failing).flatMap((verdict): Finding[] => {
    const definition = recipe.find((check) => check.id === verdict.id);

    if (definition === undefined) {
      return [];
    }

    const previous = base?.checks.find((check) => check.id === verdict.id);
    const comparison =
      verdict.verdict === 'regression'
        ? 'new'
        : baseline(previous?.outcome === 'failed', true);
    const common = {
      id: findingId(definition.kind, definition.id),
      evidence: definition.kind,
      checks: [definition.id],
      comparison,
    } as const;

    if (definition.kind === 'request-count') {
      const route = definition.path;
      const anchor = onChangedLine(
        context,
        (text) =>
          new RegExp(`["'\`]${escape(route)}(?:["'\`?#]|\\$\\{)`).test(text),
        `The route ${route} appears on this changed line.`,
      );

      return [
        {
          ...common,
          subject: `${definition.method} ${route} requests`,
          location:
            anchor === null
              ? unanchored(
                  `The route ${route} does not appear on exactly one changed line`,
                )
              : { kind: 'anchored', anchors: [anchor] },
        },
      ];
    }

    const reason = unlocatable[definition.kind];

    return reason === undefined
      ? []
      : [{ ...common, subject: verdict.name, location: unanchored(reason) }];
  });
}

function screenshotFindings({ journey }: Input): Finding[] {
  const { comparison } = journey;

  return comparison.kind === 'available' &&
    (comparison.visual.kind === 'changed' ||
      comparison.visual.kind === 'size-differs')
    ? [
        {
          id: findingId('screenshot', journey.title),
          evidence: 'screenshot',
          checks: [],
          subject: 'Screenshot pixels changed',
          comparison: 'changed',
          location: unanchored('Pixels carry no source location'),
        },
      ]
    : [];
}

function textFindings({ journey, base }: Input): Finding[] {
  const before = recorded(base, 'text');
  const after = recorded(journey.candidate, 'text');
  if (before === null || after === null) {
    return [];
  }

  return after.elements.flatMap((element): Finding[] => {
    const previous = before.elements.find(
      (item) => item.selector === element.selector,
    );
    if (
      previous === undefined ||
      previous.value === null ||
      element.value === null ||
      previous.count !== 1 ||
      element.count !== 1 ||
      previous.value === element.value
    ) {
      return [];
    }

    return [
      {
        id: findingId('text', element.selector),
        evidence: 'text',
        checks: [],
        subject: `${element.selector} text changed: ${JSON.stringify(previous.value)} → ${JSON.stringify(element.value)}`,
        comparison: 'changed',
        location: unanchored('Element text identifies no source location'),
      },
    ];
  });
}

// Findings are computed with the result, so delivery only renders them. The
// base side is used only when the comparison is available.
export function journeyFindings(
  journey: Omit<Journey, 'findings'>,
  sources: { base: SideSource | null; candidate: SideSource | null },
): Finding[] {
  const comparable = journey.comparison.kind === 'available';
  const input: Input = {
    journey,
    base: comparable ? journey.base : null,
    context: sourceContext(comparable ? sources.base : null, sources.candidate),
    candidateSource: sources.candidate,
  };

  if (journey.candidate.execution === 'unavailable') {
    return [];
  }

  return [
    ...errorFindings(input),
    ...reactFindings(input),
    ...accessibilityFindings(input),
    ...playwrightFindings(input),
    ...checkFindings(input),
    ...screenshotFindings(input),
    ...textFindings(input),
  ];
}
