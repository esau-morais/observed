import { query as sdkQuery, type Options } from '@anthropic-ai/claude-agent-sdk';
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import { Effect, Queue, Schema, Stream } from 'effect';
import {
  AgentError,
  type Adapter,
  type AgentEvent,
  type Approve,
  type StopReason,
  type ToolKind,
  workspacePath,
} from './events';
import { makeLedger } from './ledger';
import { decodeFrom } from './rpc';

const Block = Schema.Union([
  Schema.Struct({ type: Schema.Literal('text'), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal('tool_use'),
    id: Schema.String,
    name: Schema.String,
    input: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal('tool_result'),
    tool_use_id: Schema.String,
    is_error: Schema.optionalKey(Schema.NullOr(Schema.Boolean)),
  }),
  Schema.Struct({ type: Schema.String }),
]);

const Message = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(['assistant', 'user']),
    parent_tool_use_id: Schema.NullOr(Schema.String),
    message: Schema.Struct({
      content: Schema.Union([Schema.String, Schema.Array(Block)]),
    }),
  }),
  Schema.Struct({
    type: Schema.Literal('result'),
    subtype: Schema.String,
    is_error: Schema.Boolean,
    stop_reason: Schema.NullOr(Schema.String),
    total_cost_usd: Schema.Number,
    session_id: Schema.String,
    usage: Schema.Struct({
      input_tokens: Schema.Number,
      output_tokens: Schema.Number,
      cache_read_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
      cache_creation_input_tokens: Schema.optionalKey(Schema.NullOr(Schema.Number)),
    }),
    result: Schema.optionalKey(Schema.String),
    errors: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  Schema.Struct({ type: Schema.String }),
]);

const ToolInput = Schema.Struct({
  command: Schema.optionalKey(Schema.String),
  file_path: Schema.optionalKey(Schema.String),
  notebook_path: Schema.optionalKey(Schema.String),
  pattern: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  query: Schema.optionalKey(Schema.String),
});
const decodeToolInput = Schema.decodeUnknownOption(ToolInput);

const kinds: Record<string, ToolKind> = {
  Read: 'read',
  Glob: 'search',
  Grep: 'search',
  Edit: 'edit',
  MultiEdit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  Bash: 'execute',
  WebFetch: 'fetch',
  WebSearch: 'fetch',
};

const limits = new Set([
  'error_max_turns',
  'error_max_budget_usd',
  'error_max_structured_output_retries',
]);

const describeTool = (name: string, input: unknown) => {
  const fields = decodeToolInput(input);
  const known = fields._tag === 'Some' ? fields.value : {};
  const path = known.file_path ?? known.notebook_path;
  return {
    kind: kinds[name] ?? 'other',
    title: known.command ?? path ?? known.pattern ?? known.url ?? known.query ?? name,
    paths: path === undefined ? [] : [path],
  };
};

const findOnPath = (name: string, env: Readonly<Record<string, string | undefined>>) => {
  const names =
    process.platform === 'win32'
      ? (env.PATHEXT ?? '.EXE;.CMD').split(';').map((extension) => name + extension.toLowerCase())
      : [name];
  for (const directory of (env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue;
    for (const candidate of names) {
      const file = join(directory, candidate);
      try {
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        continue;
      }
    }
  }
  return undefined;
};

export type Query = (params: { prompt: string; options: Options }) => AsyncIterable<unknown>;

export interface ClaudeOptions {
  readonly approve: Approve;
  // The user's own Claude Code. Without one, Observed looks for `claude` on PATH.
  readonly executable?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly query?: Query;
}

export const claude = (options: ClaudeOptions): Adapter => {
  const agent = 'claude-code';
  const { approve } = options;
  const query = options.query ?? sdkQuery;
  const env = options.env ?? process.env;

  // The Agent SDK terms do not let a third-party app offer claude.ai login, so
  // Observed runs either the user's installed Claude Code, signed in however
  // they chose, or the SDK's own binary with an API key.
  const resolveExecutable = Effect.suspend(() => {
    const executable = options.executable ?? findOnPath('claude', env);
    if (executable !== undefined) return Effect.succeed({ pathToClaudeCodeExecutable: executable });
    if ((env.ANTHROPIC_API_KEY ?? '') !== '') return Effect.succeed({});
    return Effect.fail(
      new AgentError({
        agent,
        reason: 'not-installed',
        message: 'Install Claude Code or set ANTHROPIC_API_KEY to run Claude.',
      }),
    );
  });

  return {
    agent,
    run: (task) =>
      Stream.callback<AgentEvent, AgentError>((queue) =>
        Effect.gen(function* () {
          const emit = (event: AgentEvent) => Queue.offerUnsafe(queue, event);
          const ledger = makeLedger(task.cwd);
          const executable = yield* resolveExecutable;
          const abortController = new AbortController();
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              abortController.abort();
            }),
          );

          const canUseTool: NonNullable<Options['canUseTool']> = async (name, input, context) => {
            const described = describeTool(name, input);
            ledger.note(context.toolUseID, described);
            const allowed = await Effect.runPromise(
              approve({
                ...described,
                paths: described.paths.map((path) => workspacePath(task.cwd, path)),
              }),
            );
            if (allowed) return { behavior: 'allow', updatedInput: input };
            ledger.decline(context.toolUseID);
            return { behavior: 'deny', message: 'Observed was told not to allow this.' };
          };

          const messages = query({
            prompt: task.prompt,
            options: {
              ...executable,
              cwd: task.cwd,
              env: { ...env },
              permissionMode: 'default',
              settingSources: ['user', 'project', 'local'],
              canUseTool,
              abortController,
            },
          });

          const turn = { finished: false };
          const onMessage = Effect.fnUntraced(function* (raw: unknown) {
            const message = yield* decodeFrom(agent, 'Claude Code message', Message)(raw);
            if ((message.type === 'assistant' || message.type === 'user') && 'message' in message) {
              if (typeof message.message.content === 'string') return;
              for (const block of message.message.content) {
                if (block.type === 'text' && 'text' in block) {
                  if (message.type === 'assistant' && message.parent_tool_use_id === null) {
                    if (block.text.trim() !== '')
                      emit({ _tag: 'Message', text: block.text.trim() });
                  }
                } else if (block.type === 'tool_use' && 'name' in block) {
                  ledger.note(block.id, describeTool(block.name, block.input));
                } else if (block.type === 'tool_result' && 'tool_use_id' in block) {
                  const tool = ledger.finish(
                    block.tool_use_id,
                    block.is_error === true ? 'failed' : 'completed',
                  );
                  if (tool !== undefined) emit(tool);
                }
              }
              return;
            }
            if (message.type === 'result' && 'subtype' in message) {
              for (const tool of ledger.rest()) emit(tool);
              const { usage } = message;
              emit({
                _tag: 'Usage',
                inputTokens:
                  usage.input_tokens +
                  (usage.cache_read_input_tokens ?? 0) +
                  (usage.cache_creation_input_tokens ?? 0),
                outputTokens: usage.output_tokens,
                costUsd: message.total_cost_usd,
              });
              const stopReason: StopReason =
                message.stop_reason === 'refusal'
                  ? 'refused'
                  : limits.has(message.subtype)
                    ? 'limit'
                    : message.subtype === 'success' && !message.is_error
                      ? 'completed'
                      : 'failed';
              emit({
                _tag: 'Finished',
                session: message.session_id,
                stopReason,
                detail:
                  stopReason === 'completed'
                    ? null
                    : (message.errors?.join('\n') ?? message.result ?? message.subtype),
              });
              turn.finished = true;
            }
          });

          yield* Stream.fromAsyncIterable(
            messages,
            (error) =>
              new AgentError({
                agent,
                reason: 'exited',
                message: `Claude Code stopped: ${error instanceof Error ? error.message : String(error)}`,
              }),
          ).pipe(Stream.runForEach(onMessage));
          if (!turn.finished) {
            return yield* new AgentError({
              agent,
              reason: 'exited',
              message: 'Claude Code stopped before the turn finished.',
            });
          }
          yield* Queue.end(queue);
        }),
      ),
  };
};
