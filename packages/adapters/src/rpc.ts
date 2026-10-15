import { Data, Deferred, Effect, Exit, Queue, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { AgentError, type Agent } from './events';

export class Refusal extends Data.TaggedError('Refusal')<{
  readonly code: number;
  readonly message: string;
}> {}

export const methodNotFound = (method: string) =>
  new Refusal({ code: -32601, message: `Observed does not handle ${method}` });

const Wire = Schema.Struct({
  id: Schema.optionalKey(Schema.NullOr(Schema.Union([Schema.Number, Schema.String]))),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(Schema.Unknown),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(Schema.Struct({ code: Schema.Number, message: Schema.String })),
});
const decodeLine = Schema.decodeUnknownExit(Schema.fromJsonString(Wire));

export interface Peer {
  readonly request: (
    method: string,
    params: unknown,
  ) => Effect.Effect<unknown, AgentError | Refusal>;
  readonly notify: (method: string, params: unknown) => Effect.Effect<void>;
  // Fails once the agent stops talking: it exited, closed stdout or broke the protocol.
  readonly closed: Effect.Effect<never, AgentError>;
}

export interface PeerOptions {
  readonly agent: Agent;
  readonly command: readonly [string, ...Array<string>];
  readonly cwd: string;
  // Codex app-server speaks JSON-RPC without the "jsonrpc" member.
  readonly dialect: 'jsonrpc' | 'codex';
  readonly onNotification: (method: string, params: unknown) => Effect.Effect<void, AgentError>;
  readonly onRequest: (method: string, params: unknown) => Effect.Effect<unknown, Refusal>;
}

const encoder = new TextEncoder();
const tailLength = 2000;

export const connect = Effect.fnUntraced(function* (options: PeerOptions) {
  const { agent, dialect } = options;
  const [command, ...args] = options.command;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const scope = yield* Effect.scope;
  const input = yield* Queue.unbounded<Uint8Array>();
  const handle = yield* spawner
    .spawn(
      ChildProcess.make(command, args, {
        cwd: options.cwd,
        stdin: Stream.fromQueue(input),
        stdout: 'pipe',
        stderr: 'pipe',
      }),
    )
    .pipe(
      Effect.mapError(
        (error) =>
          new AgentError({
            agent,
            reason: error.reason._tag === 'NotFound' ? 'not-installed' : 'exited',
            message: `Could not start ${command}: ${error.message}`,
          }),
      ),
    );

  let stderr = '';
  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        stderr = (stderr + chunk).slice(-tailLength);
      }),
    ),
    Effect.ignore,
    Effect.forkIn(scope),
  );

  const send = (message: Record<string, unknown>) =>
    Queue.offer(
      input,
      encoder.encode(
        JSON.stringify(dialect === 'jsonrpc' ? { jsonrpc: '2.0', ...message } : message) + '\n',
      ),
    );

  let nextId = 0;
  const pending = new Map<number, Deferred.Deferred<unknown, AgentError | Refusal>>();
  const closed = yield* Deferred.make<never, AgentError>();

  const respond = (id: number | string, method: string, params: unknown) =>
    options.onRequest(method, params).pipe(
      Effect.matchEffect({
        onSuccess: (result) => send({ id, result }),
        onFailure: (refusal) =>
          send({ id, error: { code: refusal.code, message: refusal.message } }),
      }),
    );

  const handleLine = Effect.fnUntraced(function* (line: string) {
    if (line.trim() === '') return;
    const decoded = decodeLine(line);
    if (Exit.isFailure(decoded)) {
      return yield* new AgentError({
        agent,
        reason: 'protocol',
        message: `${command} wrote a line that is not JSON-RPC: ${line.slice(0, 200)}`,
      });
    }
    const message = decoded.value;
    if (message.method !== undefined) {
      if (message.id === undefined || message.id === null) {
        return yield* options.onNotification(message.method, message.params);
      }
      return yield* respond(message.id, message.method, message.params).pipe(Effect.forkIn(scope));
    }
    if (typeof message.id !== 'number') return;
    const waiting = pending.get(message.id);
    if (waiting === undefined) return;
    if (message.error !== undefined) {
      yield* Deferred.fail(waiting, new Refusal(message.error));
    } else {
      yield* Deferred.succeed(waiting, message.result);
    }
  });

  const hangUp = (error: AgentError) =>
    Effect.gen(function* () {
      for (const waiting of pending.values()) yield* Deferred.fail(waiting, error);
      yield* Deferred.fail(closed, error);
    });

  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach(handleLine),
    Effect.mapError((error) =>
      error instanceof AgentError
        ? error
        : new AgentError({ agent, reason: 'exited', message: error.message }),
    ),
    Effect.flatMap(() =>
      handle.exitCode.pipe(
        Effect.map((code) => `exited with code ${String(code)}`),
        Effect.orElseSucceed(() => 'closed its output'),
        Effect.map(
          (how) =>
            new AgentError({
              agent,
              reason: 'exited',
              message: [`${command} ${how} before the turn finished.`, stderr.trim()]
                .filter((part) => part !== '')
                .join('\n'),
            }),
        ),
      ),
    ),
    Effect.catch((error: AgentError) => Effect.succeed(error)),
    Effect.flatMap(hangUp),
    Effect.forkIn(scope),
  );

  const request = (method: string, params: unknown) =>
    Effect.suspend(() => {
      const id = ++nextId;
      const waiting = Deferred.makeUnsafe<unknown, AgentError | Refusal>();
      pending.set(id, waiting);
      return send({ id, method, params }).pipe(
        Effect.andThen(Deferred.await(waiting)),
        Effect.ensuring(Effect.sync(() => pending.delete(id))),
      );
    });

  const notify = (method: string, params: unknown) => send({ method, params }).pipe(Effect.asVoid);

  return { request, notify, closed: Deferred.await(closed) } satisfies Peer;
});

export const decodeFrom =
  <S extends Schema.ConstraintDecoder<unknown>>(agent: Agent, what: string, schema: S) =>
  (value: unknown) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        (error) =>
          new AgentError({
            agent,
            reason: 'protocol',
            message: `Unexpected ${what}: ${error.message}`,
          }),
      ),
    );
