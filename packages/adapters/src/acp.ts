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

const Update = Schema.Struct({ update: Schema.Struct({ sessionUpdate: Schema.String }) });
const MessageChunk = Schema.Struct({
  update: Schema.Struct({
    messageId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    content: Schema.Struct({ type: Schema.String, text: Schema.optionalKey(Schema.String) }),
  }),
});
const ToolUpdate = Schema.Struct({ update: ToolCall });

const authRequired = -32000;
const invalidParams = -32602;

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
      reason: refusal.code === authRequired ? 'unauthenticated' : 'protocol',
      message:
        refusal.code === authRequired
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
            const { sessionUpdate } = (yield* decodeFrom(agent, 'session update', Update)(params))
              .update;
            if (sessionUpdate === 'agent_message_chunk') {
              const chunk = (yield* decodeFrom(agent, 'message chunk', MessageChunk)(params))
                .update;
              const id = chunk.messageId ?? null;
              if (id !== messageId) flush();
              messageId = id;
              if (chunk.content.type === 'text') message += chunk.content.text ?? '';
              return;
            }
            if (sessionUpdate !== 'tool_call' && sessionUpdate !== 'tool_call_update') return;
            flush();
            const tool = (yield* decodeFrom(agent, 'tool call', ToolUpdate)(params)).update;
            ledger.note(tool.toolCallId, describeTool(tool));
            if (tool.status === 'completed' || tool.status === 'failed') {
              const finished = ledger.finish(tool.toolCallId, tool.status);
              if (finished !== undefined) emit(finished);
            }
          });

          const onPermission = Effect.fnUntraced(function* (params: unknown) {
            const asked = yield* decodeFrom(
              agent,
              'permission request',
              PermissionAsked,
            )(params).pipe(
              Effect.mapError(
                (error) => new Refusal({ code: invalidParams, message: error.message }),
              ),
            );
            ledger.note(asked.toolCall.toolCallId, describeTool(asked.toolCall));
            const described = describeTool(asked.toolCall);
            const allowed = yield* approve({
              kind: described.kind ?? 'other',
              title: described.title ?? asked.toolCall.toolCallId,
              paths: (described.paths ?? []).map((path) => workspacePath(task.cwd, path)),
            });
            if (!allowed) ledger.decline(asked.toolCall.toolCallId);
            const wanted = allowed ? 'allow_once' : 'reject_once';
            const option = asked.options.find((candidate) => candidate.kind === wanted);
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

          const call = <S extends Schema.ConstraintDecoder<unknown>>(
            method: string,
            params: unknown,
            schema: S,
          ) =>
            peer.request(method, params).pipe(
              Effect.mapError((error) =>
                error._tag === 'Refusal' ? refused(method)(error) : error,
              ),
              Effect.flatMap(decodeFrom(agent, `${method} result`, schema)),
            );

          const drive = Effect.gen(function* () {
            const initialized = yield* call(
              'initialize',
              {
                protocolVersion,
                clientCapabilities: {
                  fs: { readTextFile: false, writeTextFile: false },
                  terminal: false,
                },
                clientInfo: { name: 'observed', title: 'Observed', version: packageJson.version },
              },
              Initialized,
            );
            if (initialized.protocolVersion !== protocolVersion) {
              return yield* new AgentError({
                agent,
                reason: 'protocol',
                message: `${command[0]} speaks ACP version ${String(initialized.protocolVersion)}; Observed speaks ${String(protocolVersion)}.`,
              });
            }
            const { sessionId } = yield* call(
              'session/new',
              { cwd: task.cwd, mcpServers: [] },
              SessionCreated,
            );
            const prompted = yield* call(
              'session/prompt',
              { sessionId, prompt: [{ type: 'text', text: task.prompt }] },
              Prompted,
            );
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
