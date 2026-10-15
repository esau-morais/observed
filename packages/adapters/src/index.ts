import { Effect, Stream } from 'effect';
import { acp } from './acp';
import { claude } from './claude';
import { codex } from './codex';
import { AgentError, type Adapter, type Agent, type Approve } from './events';

export { acp, type AcpOptions } from './acp';
export { claude, type ClaudeOptions } from './claude';
export { codex, type CodexOptions } from './codex';
export {
  Agent,
  AgentError,
  AgentEvent,
  allowAll,
  denyAll,
  StopReason,
  ToolKind,
  ToolStatus,
  type Adapter,
  type ApprovalRequest,
  type Approve,
  type Task,
} from './events';

export interface AdapterOptions {
  readonly approve: Approve;
  // Overrides how the agent is started, such as an ACP entry point for Muse.
  // For Claude Code only the executable is used.
  readonly command?: readonly [string, ...Array<string>];
}

const acpCommands: Partial<Record<Agent, readonly [string, ...Array<string>]>> = {
  opencode: ['opencode', 'acp'],
};

export const adapterFor = (agent: Agent, options: AdapterOptions): Adapter => {
  switch (agent) {
    case 'claude-code':
      return claude({
        approve: options.approve,
        ...(options.command ? { executable: options.command[0] } : {}),
      });
    case 'codex':
      return codex({
        approve: options.approve,
        ...(options.command ? { command: options.command } : {}),
      });
    case 'opencode':
    case 'muse': {
      const command = options.command ?? acpCommands[agent];
      if (command !== undefined) return acp({ agent, approve: options.approve, command });
      return {
        agent,
        run: () =>
          Stream.fromEffect(
            Effect.fail(
              new AgentError({
                agent,
                reason: 'not-installed',
                message: `Observed does not know how to start ${agent} yet. Pass the command that starts its ACP server.`,
              }),
            ),
          ),
      };
    }
    default: {
      const _exhaustive: never = agent;
      return _exhaustive;
    }
  }
};
