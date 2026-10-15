import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Query } from '../claude';
import type { Mode } from './wire';

// Plays the Agent SDK messages Claude Code sends for the same scripted task.
export const fakeClaude = (mode: Mode, calls: { count: number } = { count: 0 }): Query =>
  async function* ({ options }) {
    calls.count += 1;
    const cwd = options.cwd ?? '';
    const file = join(cwd, 'hello.txt');
    const assistant = (content: Array<Record<string, unknown>>) => ({
      type: 'assistant',
      parent_tool_use_id: null,
      session_id: 'claude-session',
      message: { content },
    });
    yield { type: 'system', subtype: 'init', session_id: 'claude-session' };
    yield assistant([
      { type: 'text', text: "I'll create hello.txt." },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'Write',
        input: { file_path: file, content: 'hello\n' },
      },
    ]);
    if (mode === 'stop') {
      yield {
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        stop_reason: null,
        total_cost_usd: 0,
        session_id: 'claude-session',
        usage: { input_tokens: 10, output_tokens: 5 },
        errors: ['interrupted'],
      };
      return;
    }
    let allowed = true;
    if (mode === 'ask' && options.canUseTool !== undefined) {
      const decision = await options.canUseTool(
        'Write',
        { file_path: file, content: 'hello\n' },
        { signal: new AbortController().signal, toolUseID: 'toolu_1', requestId: 'r1' },
      );
      allowed = decision?.behavior === 'allow';
    }
    if (allowed) writeFileSync(file, 'hello\n');
    yield {
      type: 'user',
      parent_tool_use_id: null,
      session_id: 'claude-session',
      message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: !allowed }] },
    };
    yield assistant([{ type: 'text', text: 'Done.' }]);
    yield {
      type: 'result',
      subtype: 'success',
      is_error: false,
      stop_reason: 'end_turn',
      total_cost_usd: 0.01,
      session_id: 'claude-session',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      result: 'Done.',
    };
  };
