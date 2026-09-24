import { BunServices } from '@effect/platform-bun';
import { Cause, Effect, Exit, Option, Predicate, Schema } from 'effect';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { expect, test } from 'vitest';
import { ProcessFailure, processOutput } from '../src/capture/process';

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
