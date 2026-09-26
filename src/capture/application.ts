import {
  DateTime,
  Effect,
  FileSystem,
  Fiber,
  Schema,
  Scope,
  Stream,
} from 'effect';
import { ChildProcess } from 'effect/unstable/process';
import path from 'node:path';
import { json } from '../encoding';
import type { Project } from '../project';
import { redactText } from '../redact';
import { startProcess } from './process';

export class ApplicationFailure extends Schema.TaggedError<ApplicationFailure>()(
  'ApplicationFailure',
  { message: Schema.String },
) {}

export const startApplication = Effect.fn('startApplication')(
  function* (options: {
    workspace: string;
    evidenceDirectory: string;
    project: Project;
    concealed: readonly string[];
  }) {
    const fs = yield* FileSystem.FileSystem;
    const reservation = yield* Effect.sync(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: 0,
        fetch: () => new Response(null, { status: 503 }),
      }),
    );
    const port = reservation.port;
    yield* Effect.promise(() => reservation.stop(true));

    if (port === undefined) {
      return yield* new ApplicationFailure({
        message: 'Could not allocate an application port',
      });
    }

    const url = `http://127.0.0.1:${port}/`;
    const args = options.project.start.map((part) =>
      part.replaceAll('{port}', String(port)),
    );
    const command = args[0];

    if (command === undefined) {
      return yield* new ApplicationFailure({
        message: 'Application start command is empty',
      });
    }

    const processScope = yield* Scope.fork(yield* Scope.Scope);
    const handle = yield* startProcess(
      ChildProcess.make(command, args.slice(1), {
        cwd: options.workspace,
        env: {
          PATH: process.env.PATH,
          HOME: options.workspace,
          PORT: String(port),
          HOST: '127.0.0.1',
          LANG: 'en_US.UTF-8',
          TZ: 'UTC',
        },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        forceKillAfter: '2 seconds',
      }),
    ).pipe(Effect.provideService(Scope.Scope, processScope));

    const output = path.join(options.evidenceDirectory, 'application.log');
    yield* fs.writeFileString(output, '', { flag: 'wx' });
    let capturedOutput = '';
    const readers = yield* Effect.forEach(
      [handle.stdout, handle.stderr],
      (stream) =>
        stream.pipe(
          Stream.decodeText(),
          Stream.runForEach((chunk) =>
            Effect.sync(() => {
              capturedOutput += chunk;
            }),
          ),
          Effect.forkScoped,
        ),
    );

    yield* fs.writeFileString(
      path.join(options.evidenceDirectory, 'application.json'),
      json({
        command,
        args: args.slice(1),
        pid: handle.pid,
        url,
        startedAt: DateTime.formatIso(yield* DateTime.now),
      }),
      { flag: 'wx' },
    );

    yield* Effect.addFinalizer((exit) =>
      Effect.gen(function* () {
        yield* Scope.close(processScope, exit);
        yield* Effect.forEach(readers, (reader) => Fiber.join(reader));
        yield* fs.writeFileString(
          output,
          redactText(capturedOutput, options.concealed),
        );
        const status = yield* handle.exitCode.pipe(
          Effect.match({
            onSuccess: (code) => ({ kind: 'exited', code }) as const,
            onFailure: (error) =>
              ({ kind: 'terminated', reason: error.message }) as const,
          }),
        );
        yield* fs.writeFileString(
          path.join(options.evidenceDirectory, 'server-cleanup.json'),
          json({
            pid: handle.pid,
            url,
            stopped: !(yield* handle.isRunning),
            exit: status,
          }),
          { flag: 'wx' },
        );
      }).pipe(Effect.orDie),
    );

    while (true) {
      if (!(yield* handle.isRunning)) {
        return yield* new ApplicationFailure({
          message: 'Application exited before readiness; see application.log',
        });
      }

      const ready = yield* Effect.tryPromise({
        try: (signal) =>
          fetch(new URL(options.project.ready.path, url), {
            signal,
            redirect: 'manual',
          }),
        catch: () =>
          new ApplicationFailure({
            message: 'Application readiness request failed',
          }),
      }).pipe(
        Effect.map(
          (response) => response.status === options.project.ready.status,
        ),
        Effect.catchTag('ApplicationFailure', () => Effect.succeed(false)),
      );

      if (ready) {
        return url;
      }

      yield* Effect.sleep('100 millis');
    }
  },
);
