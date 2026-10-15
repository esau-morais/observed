import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mode, wire } from './wire';

const agent = wire('jsonrpc');
let cwd = '';

const update = (update: Record<string, unknown>) => {
  agent.notify('session/update', { sessionId: 'acp-session', update });
};
const say = (text: string, messageId: string) => {
  update({ sessionUpdate: 'agent_message_chunk', messageId, content: { type: 'text', text } });
};

agent.on('initialize', () => ({ protocolVersion: 1, agentCapabilities: {}, authMethods: [] }));
agent.on('session/new', (params) => {
  cwd = (params as { cwd: string }).cwd;
  return { sessionId: 'acp-session' };
});
agent.on('session/prompt', async () => {
  const file = join(cwd, 'hello.txt');
  say("I'll create ", 'm1');
  if (mode === 'crash') {
    process.stderr.write('fake agent crashed\n');
    process.exit(3);
  }
  update({ sessionUpdate: 'usage_update', used: 100, size: 1000 });
  say('hello.txt.', 'm1');
  update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thinking' } });
  update({
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Write hello.txt',
    kind: 'edit',
    status: 'pending',
    locations: [{ path: file }],
  });
  if (mode === 'stop') return { stopReason: 'cancelled' };
  if (mode === 'ask') {
    const answer = await agent.ask('session/request_permission', {
      sessionId: 'acp-session',
      toolCall: { toolCallId: 'call-1' },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    });
    const outcome = (answer.result as { outcome: { optionId?: string } }).outcome;
    if (outcome.optionId !== 'yes') {
      update({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'failed' });
      say('Done.', 'm2');
      return {
        stopReason: 'end_turn',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
    }
  }
  writeFileSync(file, 'hello\n');
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' });
  update({ sessionUpdate: 'tool_call_update', toolCallId: 'call-1', rawOutput: { ok: true } });
  say('Done.', 'm2');
  return { stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
});
