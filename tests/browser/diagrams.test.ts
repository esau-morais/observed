import { BunServices } from '@effect/platform-bun';
import { Effect } from 'effect';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vitest';
import { captureDiagrams } from '../../src/diagrams/capture';
import { json, sha256 } from '../../src/encoding';
import { decodePng } from '../../src/png';

test.each([
  {
    name: 'sequence wrapping',
    theme: '  sequence:\n    theme: dark\n  wrap: true',
    source:
      'sequenceDiagram\nAlice->>Bob: A message that wraps across multiple lines for the reader',
    background: [51, 51, 51],
  },
  {
    name: 'custom background',
    theme: '  theme: dark\n  themeVariables:\n    background: "#123456"',
    source: 'sequenceDiagram\nAlice->>Bob: Read this message',
    background: [18, 52, 86],
  },
  {
    name: 'translucent background',
    theme:
      '  theme: dark\n  themeVariables:\n    background: "rgba(51,51,51,0.5)"',
    source: 'sequenceDiagram\nAlice->>Bob: Read this message',
    background: [153, 153, 153],
  },
  {
    name: 'transparent background',
    theme: '  theme: dark\n  themeVariables:\n    background: transparent',
    source: 'sequenceDiagram\nAlice->>Bob: Read this message',
    background: [255, 255, 255],
  },
  {
    name: 'root flowchart',
    theme: '  theme: dark',
    source: 'flowchart LR\nA-->B',
    background: [51, 51, 51],
  },
  {
    name: 'scoped flowchart',
    theme: '  flowchart:\n    theme: dark',
    source: 'flowchart LR\nA-->B',
    background: [51, 51, 51],
  },
  {
    name: 'ER',
    theme: '  er:\n    theme: dark',
    source: 'erDiagram\nCUSTOMER ||--o{ ORDER : places',
    background: [51, 51, 51],
  },
  {
    name: 'requirement',
    theme: '  requirement:\n    theme: dark',
    source:
      'requirementDiagram\nrequirement test_req {\n id: 1\n text: "test"\n risk: low\n verifymethod: test\n}',
    background: [51, 51, 51],
  },
])(
  'records effective configuration and SVG font for $name',
  async ({ name, theme, source, background: candidateBackground }) => {
    const root = await mkdtemp(path.join(tmpdir(), 'observed-diagram-config-'));
    const projectRoot = path.join(root, 'repo');
    const directory = path.join(root, 'report');
    const git = async (...args: string[]) =>
      (
        await promisify(execFile)('git', args, { cwd: projectRoot })
      ).stdout.trim();
    try {
      await mkdir(projectRoot);
      await mkdir(directory);
      await git('init');
      await git('config', 'user.name', 'Observed test');
      await git('config', 'user.email', 'observed@example.test');
      await writeFile(
        path.join(projectRoot, 'flow.md'),
        ['```mermaid', source, '```'].join('\n'),
      );
      await git('add', 'flow.md');
      await git('commit', '-m', 'base');
      const baseCommit = await git('rev-parse', 'HEAD');
      await writeFile(
        path.join(projectRoot, 'flow.md'),
        `\`\`\`mermaid\n---\nconfig:\n${theme}\n  fontFamily: monospace\n---\n${source}\n\`\`\``,
      );
      await git('add', 'flow.md');
      await git('commit', '-m', 'candidate');
      const candidateCommit = await git('rev-parse', 'HEAD');
      const manifest = await Effect.runPromise(
        captureDiagrams({
          projectRoot,
          toolRoot: path.resolve(import.meta.dirname, '../..'),
          directory,
          revisions: { kind: 'commits', baseCommit, candidateCommit },
          resultHash: sha256('configuration regression'),
          browserArguments: ['--no-sandbox'],
        }).pipe(Effect.provide(BunServices.layer)),
      );
      expect(manifest.observation, json(manifest.observation)).toMatchObject({
        kind: 'complete',
        pairs: [
          {
            base: {
              kind: 'rendered',
              conditions: {
                theme: 'default',
                configuration: { theme: 'default' },
              },
            },
            candidate: {
              kind: 'rendered',
              conditions: {
                theme: 'dark',
                configuration: { theme: 'dark', fontFamily: 'monospace' },
                fontFamily: 'monospace',
              },
            },
          },
        ],
      });
      if (manifest.observation.kind !== 'complete') {
        throw new Error('Expected complete diagram capture');
      }

      const pair = manifest.observation.pairs[0];
      if (
        pair?.base.kind !== 'rendered' ||
        pair.candidate.kind !== 'rendered'
      ) {
        throw new Error('Expected both diagrams to render');
      }

      if (name === 'sequence wrapping') {
        expect(pair.candidate.conditions.configuration).toMatchObject({
          sequence: { wrap: true },
        });
      }

      expect(pair.base.conditions.fontFamily).toContain('trebuchet');
      for (const side of [pair.base, pair.candidate]) {
        expect(side.conditions.configurationHash).toBe(
          sha256(json(side.conditions.configuration)),
        );
        const png = decodePng(
          await readFile(path.join(directory, side.png.path)),
        );
        if (png.kind !== 'decoded') {
          throw new Error('Expected a decoded diagram PNG');
        }

        const background =
          side === pair.base ? [255, 255, 255] : candidateBackground;
        expect(Array.from(png.image.rgba.slice(0, 4))).toEqual([
          ...background,
          255,
        ]);
        if (name === 'translucent background') {
          const interior = (png.image.width * 8 + 8) * 4;
          expect(
            Array.from(png.image.rgba.slice(interior, interior + 4)),
          ).toEqual([...background, 255]);
        }

        expect(
          await readFile(path.join(directory, side.svg.path), 'utf8'),
        ).toContain(`background-color: rgb(${background.join(', ')})`);
      }

      expect(pair.base.conditions.configurationHash).not.toBe(
        pair.candidate.conditions.configurationHash,
      );
      expect(
        await readFile(
          path.join(directory, 'diagrams/0-candidate.svg'),
          'utf8',
        ),
      ).toContain('monospace');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
