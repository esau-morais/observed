import { Deferred, Effect, Queue, Schema, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import packageJson from '../package.json' with { type: 'json' };
import {
  AgentError,
  type Adapter,
  type AgentEvent,
  type Approve,
  type StopReason,
  type ToolStatus,
  workspacePath,
} from './events';
import { connect, decodeFrom, methodNotFound, Refusal } from './rpc';

const ThreadStarted = Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) });

const ItemStatus = Schema.Literals(['inProgress', 'completed', 'failed', 'declined']);

const Item = Schema.Union([
  Schema.Struct({ type: Schema.Literal('agentMessage'), id: Schema.String, text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('commandExecution'),
    id: Schema.String,
    command: Schema.String,
    status: ItemStatus,
  }),
  Schema.Struct({
    type: Schema.Literal('fileChange'),
    id: Schema.String,
    changes: Schema.Array(Schema.Struct({ path: Schema.String })),
    status: ItemStatus,
  }),
  Schema.Struct({
    type: Schema.Literal('mcpToolCall'),
    id: Schema.String,
    server: Schema.String,
    tool: Schema.String,
    status: Schema.String,
  }),
  Schema.Struct({ type: Schema.String, id: Schema.optionalKey(Schema.String) }),
]);

const ItemEvent = Schema.Struct({ threadId: Schema.String, item: Item });

const TokenUsage = Schema.Struct({
  threadId: Schema.String,
  tokenUsage: Schema.Struct({
    total: Schema.Struct({ inputTokens: Schema.Number, outputTokens: Schema.Number }),
  }),
});

const TurnCompleted = Schema.Struct({
  threadId: Schema.String,
  turn: Schema.Struct({
    status: Schema.Literals(['completed', 'interrupted', 'failed', 'inProgress']),
    error: Schema.NullOr(Schema.Struct({ message: Schema.String })),
  }),
});

const CommandApproval = Schema.Struct({
  itemId: Schema.String,
  command: Schema.optionalKey(Schema.NullOr(Schema.String)),
  reason: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
const FileApproval = Schema.Struct({ itemId: Schema.String });

const turnStops: Record<typeof TurnCompleted.Type.turn.status, StopReason> = {
  completed: 'completed',
  interrupted: 'cancelled',
  failed: 'failed',
  inProgress: 'failed',
};

const toolStatus = (status: typeof ItemStatus.Type): ToolStatus =>
  status === 'inProgress' ? 'unfinished' : status;

export interface CodexOptions {
  readonly command?: readonly [string, ...Array<string>];
  readonly approve: Approve;
}

export const codex = (options: CodexOptions): Adapter => {
  const agent = 'codex';
  const command = options.command ?? ['codex', 'app-server'];
  const { approve } = options;

  return {
    agent,
    run: (task) =>
      Stream.callback<AgentEvent, AgentError, ChildProcessSpawner.ChildProcessSpawner>((queue) =>
        Effect.gen(function* () {
          const emit = (event: AgentEvent) => Queue.offerUnsafe(queue, event);
          const finished = yield* Deferred.make<typeof TurnCompleted.Type>();
          let threadId: string | null = null;
          let usage: typeof TokenUsage.Type.tokenUsage.total | null = null;
          // File change approvals name only the item, so remember its paths.
          const changePaths = new Map<string, ReadonlyArray<string>>();

          const onItem = Effect.fnUntraced(function* (method: string, params: unknown) {
            const { threadId: thread, item } = yield* decodeFrom(agent, method, ItemEvent)(params);
            if (thread !== threadId) return;
            if (item.type === 'fileChange' && 'changes' in item) {
              changePaths.set(
                item.id,
                item.changes.map((change) => workspacePath(task.cwd, change.path)),
              );
            }
            if (method !== 'item/completed') return;
            if (item.type === 'agentMessage' && 'text' in item) {
              if (item.text.trim() !== '') emit({ _tag: 'Message', text: item.text.trim() });
            } else if (item.type === 'commandExecution' && 'command' in item) {
              emit({
                _tag: 'Tool',
                id: item.id,
                kind: 'execute',
                title: item.command,
                status: toolStatus(item.status),
                paths: [],
              });
            } else if (item.type === 'fileChange' && 'changes' in item) {
              const paths = item.changes.map((change) => workspacePath(task.cwd, change.path));
              emit({
                _tag: 'Tool',
                id: item.id,
                kind: 'edit',
                title: `Edit ${paths.join(', ')}`,
                status: toolStatus(item.status),
                paths,
              });
            } else if (item.type === 'mcpToolCall' && 'server' in item) {
              emit({
                _tag: 'Tool',
                id: item.id,
                kind: 'other',
                title: `${item.server}.${item.tool}`,
                status:
                  item.status === 'completed'
                    ? 'completed'
                    : item.status === 'failed'
                      ? 'failed'
                      : 'unfinished',
                paths: [],
              });
            }
          });

          const onNotification = Effect.fnUntraced(function* (method: string, params: unknown) {
            if (method === 'item/started' || method === 'item/completed') {
              return yield* onItem(method, params);
            }
            if (method === 'thread/tokenUsage/updated') {
              const update = yield* decodeFrom(agent, method, TokenUsage)(params);
              if (update.threadId === threadId) usage = update.tokenUsage.total;
              return;
            }
            if (method === 'turn/completed') {
              const completed = yield* decodeFrom(agent, method, TurnCompleted)(params);
              if (completed.threadId === threadId) yield* Deferred.succeed(finished, completed);
            }
          });

          const decide = (request: Parameters<Approve>[0]) =>
            approve(request).pipe(
              Effect.map((allowed) => ({ decision: allowed ? 'accept' : 'decline' })),
            );

          const asRefusal = Effect.mapError(
            (error: AgentError) => new Refusal({ code: -32602, message: error.message }),
          );

          const onRequest = Effect.fnUntraced(function* (method: string, params: unknown) {
            if (method === 'item/commandExecution/requestApproval') {
              const asked = yield* decodeFrom(
                agent,
                method,
                CommandApproval,
              )(params).pipe(asRefusal);
              return yield* decide({
                kind: 'execute',
                title: asked.command ?? asked.reason ?? asked.itemId,
                paths: [],
              });
            }
            if (method === 'item/fileChange/requestApproval') {
              const asked = yield* decodeFrom(agent, method, FileApproval)(params).pipe(asRefusal);
              const paths = changePaths.get(asked.itemId) ?? [];
              return yield* decide({
                kind: 'edit',
                title: paths.length === 0 ? asked.itemId : `Edit ${paths.join(', ')}`,
                paths,
              });
            }
            return yield* Effect.fail(methodNotFound(method));
          });

          const peer = yield* connect({
            agent,
            command,
            cwd: task.cwd,
            dialect: 'codex',
            onNotification,
            onRequest,
          });

          const refused =
            (step: string) =>
            <A, R>(effect: Effect.Effect<A, AgentError | Refusal, R>) =>
              effect.pipe(
                Effect.mapError((error) =>
                  error._tag === 'Refusal'
                    ? new AgentError({
                        agent,
                        reason: 'protocol',
                        message: `${step} failed: ${error.message}`,
                      })
                    : error,
                ),
              );

          const drive = Effect.gen(function* () {
            yield* peer
              .request('initialize', {
                clientInfo: { name: 'observed', title: 'Observed', version: packageJson.version },
                capabilities: null,
              })
              .pipe(refused('initialize'));
            yield* peer.notify('initialized', {});
            const started = yield* peer
              .request('thread/start', {
                cwd: task.cwd,
                approvalPolicy: 'on-request',
                sandbox: 'workspace-write',
              })
              .pipe(
                refused('thread/start'),
                Effect.flatMap(decodeFrom(agent, 'thread', ThreadStarted)),
              );
            threadId = started.thread.id;
            yield* peer
              .request('turn/start', {
                threadId,
                input: [{ type: 'text', text: task.prompt, text_elements: [] }],
              })
              .pipe(refused('turn/start'));
            const completed = yield* Deferred.await(finished);
            if (usage !== null) {
              emit({
                _tag: 'Usage',
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                costUsd: null,
              });
            }
            emit({
              _tag: 'Finished',
              session: threadId,
              stopReason: turnStops[completed.turn.status],
              detail: completed.turn.error?.message ?? null,
            });
          });

          yield* Effect.raceFirst(drive, peer.closed);
          yield* Queue.end(queue);
        }),
      ),
  };
};
