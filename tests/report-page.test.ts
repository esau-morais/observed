import { BunServices } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { exportComparison } from '../src/export';
import { json } from '../src/encoding';
import { comparisonSchema } from '../src/comparison-model';
import { renderReportPage } from '../src/report-page';
import { embeddedSchema } from '../src/viewer/embedded';

test('captured text cannot close the embedded evidence block or add a script to the report page', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'observed-report-page-'));
  try {
    const viewer = path.join(root, 'dist/viewer');
    await mkdir(path.join(viewer, 'assets'), { recursive: true });
    await writeFile(path.join(viewer, 'index.html'), '<!doctype html>');
    await writeFile(path.join(viewer, 'assets/index.js'), 'void 0;');
    await writeFile(path.join(viewer, 'assets/index.css'), 'body{}');
    const capture = path.join(root, 'candidate');
    await mkdir(capture);
    const transcript =
      '{"stderr":"</script><script>alert(1)</script><!-- </SCRIPT >"}\n';
    await writeFile(
      path.join(capture, 'source-failure.json'),
      json({ revision: 'missing', reason: '</script><img src=x>' }),
    );
    await writeFile(path.join(capture, 'source-transcript.jsonl'), transcript);

    const exported = await Effect.runPromise(
      exportComparison({
        journeys: [{ baseDirectory: null, candidateDirectory: capture }],
        directory: path.join(root, 'report'),
        viewerDirectory: viewer,
        mode: 'preview',
      }).pipe(Effect.provide(BunServices.layer)),
    );
    const { page } = await Effect.runPromise(
      renderReportPage(exported.directory).pipe(
        Effect.provide(BunServices.layer),
      ),
    );

    expect(page.match(/<script/gi)).toHaveLength(2);
    expect(page.match(/<\/script/gi)).toHaveLength(2);
    expect(page).not.toContain('<!--');
    const data =
      /<script type="application\/json" id="observed-evidence">(.*?)<\/script>/s.exec(
        page,
      )?.[1];
    const files = Schema.decodeUnknownSync(embeddedSchema)(data ?? '');
    expect(
      Buffer.from(
        files['/journey-1/candidate/source-transcript.jsonl']?.data ?? '',
        'base64',
      ).toString(),
    ).toBe(transcript);
    expect(
      Schema.decodeUnknownSync(Schema.fromJsonString(comparisonSchema))(
        Buffer.from(files['/result.json']?.data ?? '', 'base64').toString(),
      ).journeys[0].candidate.execution,
    ).toBe('unavailable');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
