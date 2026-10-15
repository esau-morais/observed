import { Deferred, Effect, Option, Queue, Schema, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import packageJson from '../package.json' with { type: 'json' };
import {
  AgentError,
  type Adapter,
  type AgentEvent,
  type Approve,
  type StopReason,
  workspacePath,
} from './events';
import { makeLedger } from './ledger';
import { connect, decodeFrom, methodNotFound, Refusal } from './rpc';

const ThreadStarted = Schema.Struct({ thread: Schema.Struct({ id: Schema.String }) });

const ItemStatus = Schema.Literals(['inProgress', 'completed', 'failed', 'declined']);

const ItemEvent = Schema.Struct({
  threadId: Schema.String,
  item: Schema.Struct({ type: Schema.String, id: Schema.optionalKey(Schema.String) }),
});
const AgentMessage = Schema.Struct({ item: Schema.Struct({ text: Schema.String }) });
const CommandItem = Schema.Struct({
  item: Schema.Struct({ id: Schema.String, command: Schema.String, status: ItemStatus }),
});
const FileChangeItem = Schema.Struct({
  item: Schema.Struct({
    id: Schema.String,
    changes: Schema.Array(Schema.Struct({ path: Schema.String })),
    status: ItemStatus,
  }),
});
const McpItem = Schema.Struct({
  item: Schema.Struct({
    id: Schema.String,
    server: Schema.String,
    tool: Schema.String,
    status: Schema.Literals(['inProgress', 'completed', 'failed']),
  }),
});
const OtherItem = Schema.Struct({
  item: Schema.Struct({ id: Schema.String, status: Schema.optionalKey(Schema.Unknown) }),
});
const decodeItemStatus = Schema.decodeUnknownOption(ItemStatus);

const withoutStatus = new Set(['webSearch', 'imageView']);

const notTools = new Set([
  'userMessage',
  'hookPrompt',
  'reasoning',
  'plan',
  'contextCompaction',
  'enteredReviewMode',
  'exitedReviewMode',
  'functionCallOutput',
  'subAgentActivity',
  'sleep',
]);

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
          const ledger = makeLedger(task.cwd);

          const settle = (id: string, status: typeof ItemStatus.Type) => {
            if (status === 'inProgress') return;
            const tool = ledger.finish(id, status);
            if (tool !== undefined) emit(tool);
          };

          const onItem = Effect.fnUntraced(function* (method: string, params: unknown) {
            const { threadId: thread, item } = yield* decodeFrom(agent, method, ItemEvent)(params);
            if (thread !== threadId) return;
            const completed = method === 'item/completed';
            const decode = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
              decodeFrom(agent, `${item.type} item`, schema)(params);
            switch (item.type) {
              case 'agentMessage': {
                const { text } = (yield* decode(AgentMessage)).item;
                if (completed && text.trim() !== '') emit({ _tag: 'Message', text: text.trim() });
                return;
              }
              case 'commandExecution': {
                const command = (yield* decode(CommandItem)).item;
                ledger.note(command.id, { kind: 'execute', title: command.command });
                if (completed) settle(command.id, command.status);
                return;
              }
              case 'fileChange': {
                const change = (yield* decode(FileChangeItem)).item;
                const paths = change.changes.map((file) => file.path);
                ledger.note(change.id, {
                  kind: 'edit',
                  title: `Edit ${paths.map((path) => workspacePath(task.cwd, path)).join(', ')}`,
                  paths,
                });
                if (completed) settle(change.id, change.status);
                return;
              }
              case 'mcpToolCall': {
                const call = (yield* decode(McpItem)).item;
                ledger.note(call.id, { kind: 'other', title: `${call.server}.${call.tool}` });
                if (completed) settle(call.id, call.status);
                return;
              }
              default: {
                if (notTools.has(item.type) || item.id === undefined) return;
                const other = (yield* decode(OtherItem)).item;
                ledger.note(other.id, { kind: 'other', title: item.type });
                if (!completed) return;
                if (other.status === undefined) {
                  if (withoutStatus.has(item.type)) settle(other.id, 'completed');
                  return;
                }
                const status = decodeItemStatus(other.status);
                if (Option.isSome(status)) settle(other.id, status.value);
              }
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

          const decide = (itemId: string, request: Parameters<Approve>[0]) =>
            approve(request).pipe(
              Effect.tap((allowed) =>
                Effect.sync(() => {
                  if (!allowed) ledger.decline(itemId);
                }),
              ),
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
              return yield* decide(asked.itemId, {
                kind: 'execute',
                title: asked.command ?? asked.reason ?? asked.itemId,
                paths: [],
              });
            }
            if (method === 'item/fileChange/requestApproval') {
              const asked = yield* decodeFrom(agent, method, FileApproval)(params).pipe(asRefusal);
              const known = ledger.get(asked.itemId);
              return yield* decide(asked.itemId, {
                kind: 'edit',
                title: known?.title ?? asked.itemId,
                paths: known?.paths ?? [],
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
            for (const tool of ledger.rest()) emit(tool);
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
