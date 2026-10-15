import { Effect, Queue, Schema, Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';
import packageJson from '../package.json' with { type: 'json' };
import {
  AgentError,
  type Adapter,
  type Agent,
  type AgentEvent,
  type Approve,
  type StopReason,
  type ToolKind,
  workspacePath,
} from './events';
import { makeLedger } from './ledger';
import { connect, decodeFrom, methodNotFound, Refusal } from './rpc';

const protocolVersion = 1;

const Initialized = Schema.Struct({ protocolVersion: Schema.Number });
const SessionCreated = Schema.Struct({ sessionId: Schema.String });
const Prompted = Schema.Struct({
  stopReason: Schema.String,
  usage: Schema.optionalKey(
    Schema.NullOr(Schema.Struct({ inputTokens: Schema.Number, outputTokens: Schema.Number })),
  ),
});

const ToolFields = {
  toolCallId: Schema.String,
  title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  kind: Schema.optionalKey(Schema.NullOr(Schema.String)),
  status: Schema.optionalKey(Schema.NullOr(Schema.String)),
  locations: Schema.optionalKey(
    Schema.NullOr(Schema.Array(Schema.Struct({ path: Schema.String }))),
  ),
};
const ToolCall = Schema.Struct(ToolFields);

const Update = Schema.Struct({
  update: Schema.Union([
    Schema.Struct({
      sessionUpdate: Schema.Literal('agent_message_chunk'),
      messageId: Schema.optionalKey(Schema.NullOr(Schema.String)),
      content: Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
    }),
    Schema.Struct({
      sessionUpdate: Schema.Literals(['tool_call', 'tool_call_update']),
      ...ToolFields,
    }),
    Schema.Struct({ sessionUpdate: Schema.String }),
  ]),
});

const PermissionAsked = Schema.Struct({
  toolCall: ToolCall,
  options: Schema.Array(Schema.Struct({ optionId: Schema.String, kind: Schema.String })),
});

const kinds: Record<string, ToolKind> = {
  read: 'read',
  edit: 'edit',
  delete: 'edit',
  move: 'edit',
  execute: 'execute',
  search: 'search',
  fetch: 'fetch',
};

const stopReasons: Record<string, StopReason> = {
  end_turn: 'completed',
  cancelled: 'cancelled',
  refusal: 'refused',
  max_tokens: 'limit',
  max_turn_requests: 'limit',
};

const describeTool = (call: typeof ToolCall.Type) => ({
  ...(call.kind == null ? {} : { kind: kinds[call.kind] ?? 'other' }),
  ...(call.title == null ? {} : { title: call.title }),
  ...(call.locations == null ? {} : { paths: call.locations.map((location) => location.path) }),
});

export interface AcpOptions {
  readonly agent: Agent;
  // The agent's ACP entry point, such as ["opencode", "acp"].
  readonly command: readonly [string, ...Array<string>];
  readonly approve: Approve;
}

export const acp = (options: AcpOptions): Adapter => {
  const { agent, command, approve } = options;
  const refused = (step: string) => (refusal: Refusal) =>
    new AgentError({
      agent,
      reason: refusal.code === -32000 ? 'unauthenticated' : 'protocol',
      message:
        refusal.code === -32000
          ? `${command[0]} needs you to sign in before Observed can run it: ${refusal.message}`
          : `${step} failed: ${refusal.message}`,
    });

  return {
    agent,
    run: (task) =>
      Stream.callback<AgentEvent, AgentError, ChildProcessSpawner.ChildProcessSpawner>((queue) =>
        Effect.gen(function* () {
          const emit = (event: AgentEvent) => Queue.offerUnsafe(queue, event);
          const ledger = makeLedger(task.cwd);
          let message = '';
          let messageId: string | null = null;

          const flush = () => {
            if (message.trim() !== '') emit({ _tag: 'Message', text: message.trim() });
            message = '';
          };

          const onUpdate = Effect.fnUntraced(function* (params: unknown) {
            const { update } = yield* decodeFrom(agent, 'session update', Update)(params);
            if (update.sessionUpdate === 'agent_message_chunk' && 'content' in update) {
              const id = update.messageId ?? null;
              if (id !== messageId) flush();
              messageId = id;
              if (update.content.type === 'text') message += update.content.text ?? '';
              return;
            }
            if (update.sessionUpdate === 'agent_thought_chunk') return;
            flush();
            if ('toolCallId' in update) {
              ledger.note(update.toolCallId, describeTool(update));
              if (update.status === 'completed' || update.status === 'failed') {
                const tool = ledger.finish(update.toolCallId, update.status);
                if (tool !== undefined) emit(tool);
              }
            }
          });

          const onPermission = Effect.fnUntraced(function* (params: unknown) {
            const asked = yield* decodeFrom(
              agent,
              'permission request',
              PermissionAsked,
            )(params).pipe(
              Effect.mapError((error) => new Refusal({ code: -32602, message: error.message })),
            );
            ledger.note(asked.toolCall.toolCallId, describeTool(asked.toolCall));
            const described = describeTool(asked.toolCall);
            const allowed = yield* approve({
              kind: described.kind ?? 'other',
              title: described.title ?? asked.toolCall.toolCallId,
              paths: (described.paths ?? []).map((path) => workspacePath(task.cwd, path)),
            });
            if (!allowed) ledger.decline(asked.toolCall.toolCallId);
            const wanted = allowed
              ? ['allow_once', 'allow_always']
              : ['reject_once', 'reject_always'];
            const option = wanted
              .map((kind) => asked.options.find((candidate) => candidate.kind === kind))
              .find((candidate) => candidate !== undefined);
            return option === undefined
              ? { outcome: { outcome: 'cancelled' } }
              : { outcome: { outcome: 'selected', optionId: option.optionId } };
          });

          const peer = yield* connect({
            agent,
            command,
            cwd: task.cwd,
            dialect: 'jsonrpc',
            onNotification: (method, params) =>
              method === 'session/update' ? onUpdate(params) : Effect.void,
            onRequest: (method, params) =>
              method === 'session/request_permission'
                ? onPermission(params)
                : Effect.fail(methodNotFound(method)),
          });

          const drive = Effect.gen(function* () {
            const initialized = yield* peer
              .request('initialize', {
                protocolVersion,
                clientCapabilities: {
                  fs: { readTextFile: false, writeTextFile: false },
                  terminal: false,
                },
                clientInfo: { name: 'observed', title: 'Observed', version: packageJson.version },
              })
              .pipe(
                Effect.catchTag('Refusal', (refusal) =>
                  Effect.fail(refused('initialize')(refusal)),
                ),
              )
              .pipe(Effect.flatMap(decodeFrom(agent, 'initialize result', Initialized)));
            if (initialized.protocolVersion !== protocolVersion) {
              return yield* new AgentError({
                agent,
                reason: 'protocol',
                message: `${command[0]} speaks ACP version ${String(initialized.protocolVersion)}; Observed speaks ${String(protocolVersion)}.`,
              });
            }
            const { sessionId } = yield* peer
              .request('session/new', { cwd: task.cwd, mcpServers: [] })
              .pipe(
                Effect.catchTag('Refusal', (refusal) =>
                  Effect.fail(refused('session/new')(refusal)),
                ),
              )
              .pipe(Effect.flatMap(decodeFrom(agent, 'session', SessionCreated)));
            const prompted = yield* peer
              .request('session/prompt', {
                sessionId,
                prompt: [{ type: 'text', text: task.prompt }],
              })
              .pipe(
                Effect.catchTag('Refusal', (refusal) =>
                  Effect.fail(refused('session/prompt')(refusal)),
                ),
              )
              .pipe(Effect.flatMap(decodeFrom(agent, 'prompt result', Prompted)));
            flush();
            for (const tool of ledger.rest()) emit(tool);
            if (prompted.usage != null) {
              emit({
                _tag: 'Usage',
                inputTokens: prompted.usage.inputTokens,
                outputTokens: prompted.usage.outputTokens,
                costUsd: null,
              });
            }
            emit({
              _tag: 'Finished',
              session: sessionId,
              stopReason: stopReasons[prompted.stopReason] ?? 'failed',
              detail: prompted.stopReason in stopReasons ? null : prompted.stopReason,
            });
          });

          yield* Effect.raceFirst(drive, peer.closed);
          yield* Queue.end(queue);
        }),
      ),
  };
};
