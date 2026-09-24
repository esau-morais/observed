import {
  Cause,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess } from 'effect/unstable/process';

export class ProcessFailure extends Schema.TaggedError<ProcessFailure>()(
  'ProcessFailure',
  { command: Schema.String, exitCode: Schema.Number },
) {}

export const processOutput = Effect.fn('processOutput')(function* (options: {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  transcript: string;
  timeoutMs?: number;
}) {
  const fs = yield* FileSystem.FileSystem;

  const startedAt = DateTime.formatIso(yield* DateTime.now);

  let stdout = '';

  let stderr = '';

  const execute = Effect.gen(function* () {
    const handle = yield* ChildProcess.make(options.command, options.args, {
      cwd: options.cwd,
      ...(options.env === undefined ? {} : { env: options.env }),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      forceKillAfter: '2 seconds',
    });

    const [exitCode] = yield* Effect.all(
      [
        handle.exitCode,
        handle.stdout.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Effect.sync(() => {
              stdout += chunk;
            }),
          ),
        ),
        handle.stderr.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Effect.sync(() => {
              stderr += chunk;
            }),
          ),
        ),
      ],
      { concurrency: 'unbounded' },
    );

    if (exitCode !== 0) {
      return yield* new ProcessFailure({ command: options.command, exitCode });
    }

    return stdout;
  }).pipe(Effect.scoped, Effect.timeout(options.timeoutMs ?? 30_000));

  return yield* execute.pipe(
    Effect.onExit((exit) =>
      Effect.gen(function* () {
        const finishedAt = DateTime.formatIso(yield* DateTime.now);

        yield* fs.writeFileString(
          options.transcript,
          `${JSON.stringify({
            command: options.command,
            args: options.args,
            startedAt,
            finishedAt,
            stdout,
            stderr,
            outcome: Exit.isSuccess(exit)
              ? 'complete'
              : Cause.pretty(exit.cause),
          })}\n`,
          { flag: 'a' },
        );
      }),
    ),
  );
});
