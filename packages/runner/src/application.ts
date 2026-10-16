import { json } from '@observed/judge';
import { DateTime, Effect, Fiber, FileSystem, Schema, Scope, Stream } from 'effect';
import { ChildProcess } from 'effect/process';
import path from 'node:path';
import type { Project } from './project';
import { redactText } from './redact';

export class ApplicationFailure extends Schema.TaggedError<ApplicationFailure>()(
  'ApplicationFailure',
  { message: Schema.String },
) {}

const freePort = Effect.acquireUseRelease(
  Effect.sync(() =>
    Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null, { status: 503 }) }),
  ),
  (server) => Effect.succeed(server.port),
  (server) => Effect.promise(() => server.stop(true)),
);

export const startApplication = Effect.fn('startApplication')(function* (options: {
  workspace: string;
  evidenceDirectory: string;
  project: Project;
  concealed: readonly string[];
}) {
  const fs = yield* FileSystem.FileSystem;
  const port = yield* freePort;

  if (port === undefined) {
    return yield* new ApplicationFailure({ message: 'Could not allocate an application port' });
  }

  const url = `http://127.0.0.1:${port}/`;
  const withPort = (part: string) => part.replaceAll('{port}', String(port));
  const [program, ...rest] = options.project.start;
  const command = withPort(program);
  const args = rest.map(withPort);

  const processScope = yield* Scope.fork(yield* Scope.Scope);
  const handle = yield* ChildProcess.make(command, args, {
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
  }).pipe(
    Effect.provideService(Scope.Scope, processScope),
    Effect.mapError(
      (error) =>
        new ApplicationFailure({ message: `Could not start ${command}: ${error.message}` }),
    ),
  );

  const output = path.join(options.evidenceDirectory, 'application.log');
  let captured = '';
  const readers = yield* Effect.forEach([handle.stdout, handle.stderr], (stream) =>
    stream.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.sync(() => {
          captured += chunk;
        }),
      ),
      Effect.ignore,
      Effect.forkScoped,
    ),
  );

  yield* fs.writeFileString(
    path.join(options.evidenceDirectory, 'application.json'),
    json({
      command,
      args,
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
      yield* fs.writeFileString(output, redactText(captured, options.concealed), { flag: 'wx' });
      const status = yield* handle.exitCode.pipe(
        Effect.match({
          onSuccess: (code) => ({ kind: 'exited', code }) as const,
          onFailure: (error) => ({ kind: 'terminated', reason: error.message }) as const,
        }),
      );
      yield* fs.writeFileString(
        path.join(options.evidenceDirectory, 'server-cleanup.json'),
        json({ pid: handle.pid, url, stopped: !(yield* handle.isRunning), exit: status }),
        { flag: 'wx' },
      );
    }).pipe(Effect.orDie),
  );

  const readyUrl = new URL(options.project.ready.path, url);

  for (;;) {
    if (!(yield* handle.isRunning.pipe(Effect.orDie))) {
      return yield* new ApplicationFailure({
        message: 'Application exited before readiness; see application.log',
      });
    }

    const ready = yield* Effect.tryPromise((signal) =>
      fetch(readyUrl, { signal, redirect: 'manual' }),
    ).pipe(
      Effect.map((response) => response.status === options.project.ready.status),
      Effect.orElseSucceed(() => false),
    );

    if (ready) {
      return url;
    }

    yield* Effect.sleep('50 millis');
  }
});
