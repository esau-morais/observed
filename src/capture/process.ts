import {
  Cause,
  DateTime,
  Effect,
  Exit,
  FileSystem,
  Predicate,
  Schema,
  Stream,
} from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import { conceal, redact, redactText } from '../redact';

export class ProcessFailure extends Schema.TaggedError<ProcessFailure>()(
  'ProcessFailure',
  {
    command: Schema.String,
    exitCode: Schema.Number,
    message: Schema.String,
    stderr: Schema.String,
  },
) {}

export const startProcess = (command: ChildProcess.StandardCommand) =>
  Effect.acquireRelease(command, (handle) =>
    // rc.117 scoped release only sends SIGTERM after a nonzero leader exit.
    handle.kill({ killSignal: 'SIGTERM', forceKillAfter: '2 seconds' }).pipe(
      Effect.catchTag('PlatformError', (error) =>
        Effect.gen(function* () {
          const stopped = yield* Effect.sync(() => {
            try {
              process.kill(
                process.platform === 'win32' ? handle.pid : -Number(handle.pid),
                0,
              );

              return false;
            } catch (cause) {
              if (
                Predicate.hasProperty(cause, 'code') &&
                cause.code === 'ESRCH'
              ) {
                return true;
              }

              throw cause;
            }
          });

          if (!stopped) {
            return yield* error;
          }
        }),
      ),
      Effect.orDie,
    ),
  );

export const processOutput = Effect.fn('processOutput')(function* (options: {
  command: string;
  args: readonly string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  transcript: string;
  timeoutMs?: number;
  stdin?: string;
  concealed?: readonly string[];
}) {
  const fs = yield* FileSystem.FileSystem;
  const hide = (value: string) => conceal(value, options.concealed ?? []);
  const startedAt = DateTime.formatIso(yield* DateTime.now);
  let stdout = '';
  let stderr = '';

  const execute = Effect.gen(function* () {
    const handle = yield* startProcess(
      ChildProcess.make(options.command, options.args, {
        cwd: options.cwd,
        ...(options.env === undefined ? {} : { env: options.env }),
        stdin:
          options.stdin === undefined
            ? 'ignore'
            : Stream.make(new TextEncoder().encode(options.stdin)),
        stdout: 'pipe',
        stderr: 'pipe',
        forceKillAfter: '2 seconds',
      }),
    );

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
      return yield* new ProcessFailure({
        command: options.command,
        exitCode,
        stderr: redactText(stderr, options.concealed),
        message: `${options.command} exited with code ${exitCode}; see transcript.jsonl for original output`,
      });
    }

    return stdout;
  }).pipe(Effect.scoped, Effect.timeout(options.timeoutMs ?? 30_000));

  return yield* execute.pipe(
    Effect.onExit((exit) =>
      Effect.gen(function* () {
        const finishedAt = DateTime.formatIso(yield* DateTime.now);

        yield* fs.writeFileString(
          options.transcript,
          `${JSON.stringify(
            redact({
              command: options.command,
              args: options.args.map(hide),
              startedAt,
              finishedAt,
              stdout: redactText(stdout, options.concealed),
              stderr: redactText(stderr, options.concealed),
              outcome: Exit.isSuccess(exit)
                ? 'complete'
                : hide(Cause.pretty(exit.cause)),
            }),
          )}\n`,
          { flag: 'a' },
        );
      }),
    ),
  );
});
