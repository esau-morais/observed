import { BunServices } from '@effect/platform-bun';
import { Cause, Effect, Exit, Option, Predicate, Schema } from 'effect';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { ProcessFailure, processOutput } from '../src/capture/process';
import { startApplication } from '../src/capture/application';
import { projectSchema } from '../src/project';
import shop from '../examples/shop/observed.json';

const parsePid = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Int.check(Schema.isGreaterThan(1))),
);

const parseTranscript = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      stdout: Schema.String,
      stderr: Schema.String,
      outcome: Schema.String,
    }),
  ),
);

const stubbornProcess = `
import { appendFileSync, writeFileSync, writeSync } from 'node:fs';

const role = process.argv[2];

process.on('SIGTERM', () => {
  appendFileSync('signals.log', role + ':' + process.pid + '\\n');
});

writeSync(1, role + ' stdout before stop\\n');

writeSync(2, role + ' stderr before stop\\n');

appendFileSync('heartbeats.log', role + ':' + process.pid + '\\n');

setInterval(() => {
  appendFileSync('heartbeats.log', role + ':' + process.pid + '\\n');
}, 30);

writeFileSync(role + '.pid', JSON.stringify(process.pid));

if (role === 'parent') {
  Bun.spawn([process.execPath, process.argv[1], 'child'], {
    cwd: process.cwd(),
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
}
`;

test.each([
  { runner: 'application', code: 0 },
  { runner: 'application', code: 17 },
  { runner: 'command', code: 0 },
  { runner: 'command', code: 17 },
])(
  '$runner cleanup stops descendants after their wrapper exits with $code',
  async ({ runner, code }) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'observed-wrapper-'));
    const helper = path.join(directory, 'wrapper.ts');
    await writeFile(
      helper,
      `
    import { writeFileSync } from 'node:fs';
    if (process.argv[2] === 'child') {
      process.on('SIGTERM', () => {});
      writeFileSync('child.pid', JSON.stringify(process.pid));
      setInterval(() => console.log('child output'), 25);
    } else {
      Bun.spawn([process.execPath, import.meta.path, 'child'], { stdout: 'inherit', stderr: 'inherit' }).unref();
      while (!(await Bun.file('child.pid').exists())) { await Bun.sleep(10); }
      process.exit(${code});
    }
  `,
    );
    let pid: number | undefined;
    let emergency = false;
    const watchdog = setTimeout(() => {
      emergency = true;

      if (pid !== undefined) {
        stopOwnedProcess(pid);
      }
    }, 6000);
    const pending = Effect.runPromiseExit(
      Effect.gen(function* () {
        if (runner === 'application') {
          return yield* startApplication({
            workspace: directory,
            evidenceDirectory: directory,
            project: Schema.decodeUnknownSync(projectSchema)({
              ...shop,
              start: [process.execPath, helper],
            }),
          });
        }

        return yield* processOutput({
          command: process.execPath,
          args: [helper],
          cwd: directory,
          transcript: path.join(directory, 'transcript.jsonl'),
          timeoutMs: 500,
        });
      }).pipe(
        Effect.scoped,
        Effect.timeout(runner === 'application' ? '500 millis' : '6 seconds'),
        Effect.provide(BunServices.layer),
      ),
    );

    try {
      await expect
        .poll(
          async () => {
            pid = await readPid(path.join(directory, 'child.pid'));

            return pid;
          },
          { timeout: 1500 },
        )
        .toBeDefined();
      await pending;
      expect(emergency).toBe(false);

      if (pid === undefined) {
        throw new Error('Owned descendant PID is missing');
      }

      expect(await processIsLive(pid)).toBe(false);
      if (runner === 'application') {
        const cleanup = Schema.decodeUnknownSync(
          Schema.fromJsonString(
            Schema.Struct({
              stopped: Schema.Boolean,
              exit: Schema.Struct({
                kind: Schema.Literal('exited'),
                code: Schema.Number,
              }),
            }),
          ),
        )(await readFile(path.join(directory, 'server-cleanup.json'), 'utf8'));
        expect(cleanup).toEqual({
          stopped: true,
          exit: { kind: 'exited', code },
        });
        expect(
          await readFile(path.join(directory, 'application.log'), 'utf8'),
        ).toContain('child output');
      } else {
        const transcript = parseTranscript(
          await readFile(path.join(directory, 'transcript.jsonl'), 'utf8'),
        );
        expect(transcript.stdout).toContain('child output');
        expect(transcript.outcome).toContain('TimeoutError');
      }
    } finally {
      clearTimeout(watchdog);

      if (pid !== undefined && (await processIsLive(pid))) {
        stopOwnedProcess(pid);
      }

      await rm(directory, { recursive: true, force: true });
    }
  },
  8000,
);

async function readPid(filename: string): Promise<number | undefined> {
  try {
    return parsePid(await readFile(filename, 'utf8'));
  } catch (error) {
    if (Predicate.hasProperty(error, 'code') && error.code === 'ENOENT') {
      return undefined;
    }

    throw error;
  }
}

async function processIsLive(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);

    if (process.platform === 'linux') {
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8');

      const state = stat.slice(
        stat.lastIndexOf(')') + 2,
        stat.lastIndexOf(')') + 3,
      );

      return state !== 'Z' && state !== 'X';
    }

    return true;
  } catch (error) {
    if (
      Predicate.hasProperty(error, 'code') &&
      (error.code === 'ESRCH' || error.code === 'ENOENT')
    ) {
      return false;
    }

    throw error;
  }
}

function stopOwnedProcess(pid: number): void {
  if (pid === process.pid) {
    throw new Error('Refusing to kill the test runner');
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (Predicate.hasProperty(error, 'code') && error.code === 'ESRCH') {
      return;
    }

    throw error;
  }
}

test.each(['timeout', 'cancellation'] as const)(
  '%s retains partial output and stops a SIGTERM-resistant process and its descendant within the force-kill bound',
  async (mode) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'observed-process-'));
    const helper = path.join(directory, 'stubborn.ts');
    const transcript = path.join(directory, 'transcript.jsonl');

    await writeFile(helper, stubbornProcess);

    const controller = new AbortController();
    const pids = new Set<number>();
    let emergencyCleanup = false;

    const watchdog = setTimeout(() => {
      emergencyCleanup = true;

      controller.abort();

      for (const pid of pids) {
        stopOwnedProcess(pid);
      }
    }, 9_000);

    const startedAt = performance.now();

    const pending = Effect.runPromiseExit(
      processOutput({
        command: process.execPath,
        args: [helper, 'parent'],
        cwd: directory,
        transcript,
        timeoutMs: mode === 'timeout' ? 3_000 : 30_000,
      }).pipe(Effect.provide(BunServices.layer)),
      { signal: controller.signal },
    );

    try {
      await expect
        .poll(
          async () => {
            for (const role of ['parent', 'child']) {
              const pid = await readPid(path.join(directory, `${role}.pid`));

              if (pid !== undefined) {
                pids.add(pid);
              }
            }

            return pids.size;
          },
          { timeout: 2_000 },
        )
        .toBe(2);

      expect(pids.has(process.pid)).toBe(false);

      expect(await Promise.all([...pids].map(processIsLive))).toEqual([
        true,
        true,
      ]);

      const cancellationStartedAt = performance.now();

      if (mode === 'cancellation') {
        controller.abort();
      }

      const exit = await pending;

      const elapsed =
        performance.now() -
        (mode === 'timeout' ? startedAt + 3_000 : cancellationStartedAt);

      expect(emergencyCleanup).toBe(false);

      expect(elapsed).toBeLessThan(4_500);

      if (!Exit.isFailure(exit)) {
        throw new Error('The interrupted process unexpectedly succeeded');
      }

      if (mode === 'timeout') {
        expect(Cause.pretty(exit.cause)).toContain('TimeoutError');
      } else {
        expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      }

      const records = (await readFile(transcript, 'utf8'))
        .trimEnd()
        .split('\n')
        .map((line) => parseTranscript(line));

      expect(records).toHaveLength(1);

      expect(records[0]).toMatchObject({
        stdout: 'parent stdout before stop\nchild stdout before stop\n',
        stderr: 'parent stderr before stop\nchild stderr before stop\n',
      });

      expect(records[0]?.outcome).not.toBe('complete');

      const signals = await readFile(
        path.join(directory, 'signals.log'),
        'utf8',
      );

      for (const pid of pids) {
        expect(signals).toContain(`:${pid}\n`);
      }

      await expect
        .poll(async () => Promise.all([...pids].map(processIsLive)), {
          timeout: 1_000,
        })
        .toEqual([false, false]);

      const heartbeats = await readFile(
        path.join(directory, 'heartbeats.log'),
        'utf8',
      );

      expect(
        heartbeats.split('\n').filter((line) => line !== '').length,
      ).toBeGreaterThanOrEqual(2);

      await delay(150);

      expect(
        await readFile(path.join(directory, 'heartbeats.log'), 'utf8'),
      ).toBe(heartbeats);
    } finally {
      clearTimeout(watchdog);

      controller.abort();

      for (const role of ['parent', 'child']) {
        const pid = await readPid(path.join(directory, `${role}.pid`));

        if (pid !== undefined && (await processIsLive(pid))) {
          stopOwnedProcess(pid);
        }
      }

      await pending;

      await rm(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

test('nonzero exits retain stdout and stderr, name the exit code and transcript, and surface transcript write failures', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'observed-process-'));
  const transcript = path.join(directory, 'transcript.jsonl');

  const args = [
    '-e',
    "import { writeSync } from 'node:fs';\n\nwriteSync(1, 'stdout before exit\\n');\n\nwriteSync(2, 'original application failure\\n');\n\nprocess.exit(17);",
  ];

  try {
    const exit = await Effect.runPromiseExit(
      processOutput({
        command: process.execPath,
        args,
        cwd: directory,
        transcript,
      }).pipe(Effect.provide(BunServices.layer)),
    );

    if (!Exit.isFailure(exit)) {
      throw new Error('A nonzero process unexpectedly succeeded');
    }

    const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));

    if (!(failure instanceof ProcessFailure)) {
      throw new Error(Cause.pretty(exit.cause));
    }

    expect(failure.exitCode).toBe(17);

    expect(failure.message).toMatch(/(?:code|exit)\s+17/);

    expect(failure.message).toContain('transcript.jsonl');

    const record = parseTranscript(
      (await readFile(transcript, 'utf8')).trimEnd(),
    );

    expect(record.stdout).toBe('stdout before exit\n');

    expect(record.stderr).toBe('original application failure\n');

    const blockedTranscript = path.join(directory, 'blocked-transcript');

    await mkdir(blockedTranscript);

    const recordingExit = await Effect.runPromiseExit(
      processOutput({
        command: process.execPath,
        args,
        cwd: directory,
        transcript: blockedTranscript,
      }).pipe(Effect.provide(BunServices.layer)),
    );

    if (!Exit.isFailure(recordingExit)) {
      throw new Error(
        'Writing a transcript to a directory unexpectedly succeeded',
      );
    }

    expect(Cause.pretty(recordingExit.cause)).toContain(blockedTranscript);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
