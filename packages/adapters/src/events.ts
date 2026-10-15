import { isAbsolute, relative } from 'node:path';
import { Data, Effect, Schema, type Stream } from 'effect';
import type { ChildProcessSpawner } from 'effect/process';

export const Agent = Schema.Literals(['claude-code', 'codex', 'opencode', 'muse']);
export type Agent = typeof Agent.Type;

export const ToolKind = Schema.Literals(['read', 'edit', 'execute', 'search', 'fetch', 'other']);
export type ToolKind = typeof ToolKind.Type;

export const ToolStatus = Schema.Literals(['completed', 'failed', 'declined', 'unfinished']);
export type ToolStatus = typeof ToolStatus.Type;

export const StopReason = Schema.Literals(['completed', 'cancelled', 'refused', 'limit', 'failed']);
export type StopReason = typeof StopReason.Type;

// Events arrive whole: a message once the agent has finished it, a tool call
// once it has finished or the turn ended without it finishing.
export const AgentEvent = Schema.Union([
  Schema.TaggedStruct('Message', { text: Schema.String }),
  Schema.TaggedStruct('Tool', {
    id: Schema.String,
    kind: ToolKind,
    title: Schema.String,
    status: ToolStatus,
    paths: Schema.Array(Schema.String),
  }),
  Schema.TaggedStruct('Usage', {
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
    costUsd: Schema.NullOr(Schema.Number),
  }),
  Schema.TaggedStruct('Finished', {
    session: Schema.String,
    stopReason: StopReason,
    detail: Schema.NullOr(Schema.String),
  }),
]);
export type AgentEvent = typeof AgentEvent.Type;

// Agents name files absolutely or relative to the workspace; reports always use
// the workspace-relative form so the same change reads the same from any agent.
export const workspacePath = (cwd: string, path: string) =>
  isAbsolute(path) ? relative(cwd, path) : path;

export interface Task {
  readonly cwd: string;
  readonly prompt: string;
}

export interface ApprovalRequest {
  readonly kind: ToolKind;
  readonly title: string;
  readonly paths: ReadonlyArray<string>;
}

// Answers the approvals an agent asks for. Which actions it asks about follows
// the user's own agent settings, such as Claude Code allow rules or the Codex sandbox.
export type Approve = (request: ApprovalRequest) => Effect.Effect<boolean>;

export const allowAll: Approve = () => Effect.succeed(true);
export const denyAll: Approve = () => Effect.succeed(false);

export class AgentError extends Data.TaggedError('AgentError')<{
  readonly agent: Agent;
  readonly reason: 'not-installed' | 'unauthenticated' | 'protocol' | 'exited';
  readonly message: string;
}> {}

export interface Adapter {
  readonly agent: Agent;
  readonly run: (
    task: Task,
  ) => Stream.Stream<AgentEvent, AgentError, ChildProcessSpawner.ChildProcessSpawner>;
}
