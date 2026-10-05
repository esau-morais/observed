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

test.each(['  theme: dark', '  flowchart:\n    theme: dark'])(
  'records effective configuration and SVG font for %s',
  async (theme) => {
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
        '```mermaid\nflowchart LR\nA-->B\n```',
      );
      await git('add', 'flow.md');
      await git('commit', '-m', 'base');
      const baseCommit = await git('rev-parse', 'HEAD');
      await writeFile(
        path.join(projectRoot, 'flow.md'),
        `\`\`\`mermaid\n---\nconfig:\n${theme}\n  fontFamily: monospace\n---\nflowchart LR\nA-->B\n\`\`\``,
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
      expect(manifest.observation).toMatchObject({
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

      expect(pair.base.conditions.fontFamily).toContain('trebuchet');
      for (const side of [pair.base, pair.candidate]) {
        expect(side.conditions.configurationHash).toBe(
          sha256(json(side.conditions.configuration)),
        );
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
