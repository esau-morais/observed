import { DateTime, Effect, FileSystem, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  captureArtifactSchema,
  digest,
  text,
  timestamp,
} from '../capture/model';
import { checksForRun } from '../checks/playwright';
import type { Check, SideArtifact } from '../comparison-model';
import { json, sha256 } from '../encoding';
import { playwright as playwrightKind } from '../evidence-kinds/playwright';
import { escapeText } from '../markdown';
import { playwright as playwrightSection } from '../report-sections/playwright';
import { redactText } from '../redact';
import { checkLabels } from '../result-text';
import { collectReport } from './collect';
import {
  parseHtmlReport,
  parseJsonReport,
  PlaywrightReportError,
  type ParsedReport,
} from './report';

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const importConclusionKinds = ['failed', 'unknown', 'passed'] as const;

const conclusionLabels = {
  failed: 'Failed',
  unknown: 'Unknown',
  passed: 'Passed',
} satisfies Record<(typeof importConclusionKinds)[number], string>;

export const importExitCodes = {
  failed: 2,
  unknown: 1,
  passed: 0,
} satisfies Record<(typeof importConclusionKinds)[number], number>;

const importSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  kind: Schema.Literal('playwright-import'),
  id: text,
  importedAt: timestamp,
  observed: Schema.Struct({ version: text }),
  input: Schema.Struct({
    kind: Schema.Literals(['json', 'html']),
    path: text,
    sha256: digest,
  }),
  producer: Schema.Struct({
    name: Schema.Literal('Playwright'),
    version: text,
  }),
  evidence: Schema.Struct({
    kind: Schema.Literal('playwright'),
    schemaVersion: Schema.Literal(playwrightKind.schemaVersion),
    path: text,
    sha256: digest,
  }),
  artifacts: Schema.Array(captureArtifactSchema),
  summary: Schema.Struct({
    passed: count,
    failed: count,
    unknown: count,
    total: count,
  }),
  conclusion: Schema.Struct({
    kind: Schema.Literals(importConclusionKinds),
    text,
  }),
});

export type PlaywrightImport = typeof importSchema.Type;

function conclude(checks: readonly Check[]): PlaywrightImport['conclusion'] {
  const named = (outcome: Check['outcome']) =>
    checks.filter((check) => check.outcome === outcome);
  const failed = named('failed');
  const unknown = named('unknown');
  const list = (items: readonly Check[]) =>
    items.map((check) => check.name).join(', ');

  if (failed.length > 0) {
    return {
      kind: 'failed',
      text: `Playwright reported ${failed.length} of ${checks.length} imported checks failed: ${list(failed)}.`,
    };
  }

  if (unknown.length > 0) {
    return {
      kind: 'unknown',
      text: `No imported test failed, but ${unknown.length} of ${checks.length} imported checks are unknown: ${list(unknown)}.`,
    };
  }

  return {
    kind: 'passed',
    text: `Playwright reported all ${checks.length} imported tests passed. Observed didn't run them.`,
  };
}

function renderImport(options: {
  manifest: PlaywrightImport;
  checks: readonly Check[];
  section: string;
}): string {
  const { manifest, checks } = options;

  return [
    '# Imported Playwright results',
    `**${conclusionLabels[manifest.conclusion.kind]}**: ${escapeText(manifest.conclusion.text)}`,
    escapeText(
      `Imported from ${manifest.input.path} (${manifest.input.kind === 'json' ? 'JSON report' : 'HTML report'}, SHA-256 ${manifest.input.sha256}) at ${manifest.importedAt}. These are Playwright's results for one run; Observed didn't capture or compare the app.`,
    ),
    '## Imported checks',
    checks
      .map((check) =>
        [
          `- **${checkLabels[check.outcome]}**: ${escapeText(check.name)}`,
          `  - Scope: ${escapeText(check.scope)}`,
          `  - ${escapeText(check.detail)}`,
        ].join('\n'),
      )
      .join('\n'),
    '## Playwright tests',
    options.section,
  ].join('\n\n');
}

const readReport = Effect.fnUntraced(function* (
  input: string,
  root: string | null,
) {
  const fs = yield* FileSystem.FileSystem;
  const real = yield* fs.realPath(input);
  const info = yield* fs.stat(real);

  if (info.type === 'Directory') {
    const index = path.join(real, 'index.html');

    if (!(yield* fs.exists(index))) {
      return yield* new PlaywrightReportError({
        message: `${input} has no index.html. Pass a Playwright HTML report directory or a JSON report file.`,
      });
    }

    const bytes = yield* fs.readFile(index);

    return {
      kind: 'html',
      path: real,
      raw: bytes,
      rawName: 'index.html',
      // Its attachments sit in the report directory.
      root: real,
      report: yield* parseHtmlReport(new TextDecoder().decode(bytes), real),
    } as const;
  }

  const bytes = yield* fs.readFile(real);
  const report: ParsedReport = yield* parseJsonReport(
    new TextDecoder().decode(bytes),
  );

  return {
    kind: 'json',
    path: real,
    raw: bytes,
    rawName: 'report.json',
    root: yield* fs.realPath(root ?? path.dirname(real)),
    report,
  } as const;
});

// Imports one Playwright run into a new directory: its attachments, the
// playwright evidence file, one check per test, and report.md. The report's
// own paths are data; only files under `root` are copied.
export const importPlaywright = Effect.fn('importPlaywright')(
  function* (options: {
    input: string;
    root: string | null;
    directory: string;
    observedVersion: string;
  }) {
    const fs = yield* FileSystem.FileSystem;
    const source = yield* readReport(options.input, options.root);
    const directory = path.resolve(options.directory);

    yield* fs.makeDirectory(directory);

    const pending = new Map<string, { path: string; description: string }>();
    const addArtifact = (id: string, filename: string, description: string) => {
      pending.set(id, { path: filename, description });
    };

    yield* fs.makeDirectory(path.join(directory, 'playwright'));
    yield* fs.writeFile(
      path.join(directory, 'playwright', source.rawName),
      source.kind === 'json'
        ? new TextEncoder().encode(
            redactText(new TextDecoder().decode(source.raw)),
          )
        : source.raw,
      { flag: 'wx' },
    );
    addArtifact(
      'playwright-report',
      `playwright/${source.rawName}`,
      source.kind === 'json'
        ? "Playwright's JSON report; credentials redacted"
        : "Playwright's HTML report page, which embeds the report data",
    );

    const value = yield* collectReport({
      report: source.report,
      exitCode: null,
      root: source.root,
      workspace: null,
      directory,
      addArtifact,
    });
    const evidencePath = 'evidence/playwright.json';
    const file = yield* Schema.encodeUnknownEffect(playwrightKind.file)({
      kind: playwrightKind.kind,
      schemaVersion: playwrightKind.schemaVersion,
      value,
    });
    const evidenceText = redactText(json(file));

    yield* fs.makeDirectory(path.join(directory, 'evidence'));
    yield* fs.writeFileString(
      path.join(directory, evidencePath),
      evidenceText,
      {
        flag: 'wx',
      },
    );

    const artifacts: PlaywrightImport['artifacts'][number][] = [];

    for (const [id, artifact] of pending) {
      artifacts.push({
        id,
        ...artifact,
        sha256: sha256(yield* fs.readFile(path.join(directory, artifact.path))),
      });
    }

    const checks = checksForRun(value);
    const manifest = yield* Schema.decodeUnknownEffect(importSchema)({
      schemaVersion: 1,
      kind: 'playwright-import',
      id: randomUUID(),
      importedAt: DateTime.formatIso(yield* DateTime.now),
      observed: { version: options.observedVersion },
      input: {
        kind: source.kind,
        path: source.path,
        sha256: sha256(source.raw),
      },
      producer: {
        name: 'Playwright',
        version: value.version ?? 'not recorded',
      },
      evidence: {
        kind: 'playwright',
        schemaVersion: playwrightKind.schemaVersion,
        path: evidencePath,
        sha256: sha256(evidenceText),
      },
      artifacts,
      summary: {
        passed: checks.filter((check) => check.outcome === 'passed').length,
        failed: checks.filter((check) => check.outcome === 'failed').length,
        unknown: checks.filter((check) => check.outcome === 'unknown').length,
        total: checks.length,
      },
      conclusion: conclude(checks),
    });
    const links: SideArtifact[] = artifacts.map((artifact) => ({
      id: artifact.id,
      description: artifact.description,
      integrity: 'verified',
      path: artifact.path.split('/').map(encodeURIComponent).join('/'),
    }));

    yield* fs.writeFileString(
      path.join(directory, 'import.json'),
      json(manifest),
      { flag: 'wx' },
    );
    yield* fs.writeFileString(
      path.join(directory, 'report.md'),
      `${renderImport({
        manifest,
        checks,
        section: playwrightSection({
          base: null,
          candidate: {
            evidence: { kind: 'playwright', status: 'recorded', value },
            artifacts: links,
          },
          comparable: false,
        }),
      })}\n`,
      { flag: 'wx' },
    );

    return { directory, report: path.join(directory, 'report.md'), manifest };
  },
);
