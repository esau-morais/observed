import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mode, wire } from './wire';

const agent = wire('codex');
const threadId = 'codex-thread';
const turnId = 'codex-turn';
let cwd = '';

const item = (method: 'item/started' | 'item/completed', item: Record<string, unknown>) => {
  agent.notify(method, { threadId, turnId, item });
};

agent.on('initialize', () => ({
  userAgent: 'fake-codex',
  codexHome: '/tmp',
  platformFamily: 'unix',
}));
agent.on('thread/start', (params) => {
  cwd = (params as { cwd: string }).cwd;
  return { thread: { id: threadId } };
});
agent.on('turn/start', () => {
  setTimeout(() => void play(), 0);
  return { turn: { id: turnId, status: 'inProgress', items: [], error: null } };
});

const play = async () => {
  const file = join(cwd, 'hello.txt');
  item('item/completed', { type: 'agentMessage', id: 'm1', text: "I'll create hello.txt." });
  if (mode === 'crash') {
    process.stderr.write('fake agent crashed\n');
    process.exit(3);
  }
  const change = {
    type: 'fileChange',
    id: 'f1',
    changes: [{ path: file, kind: { type: 'add' }, diff: '' }],
  };
  item('item/started', { ...change, status: 'inProgress' });
  if (mode === 'stop') {
    agent.notify('turn/completed', {
      threadId,
      turn: { id: turnId, status: 'interrupted', error: null },
    });
    return;
  }
  let status = 'completed';
  if (mode === 'ask') {
    const answer = await agent.ask('item/fileChange/requestApproval', {
      threadId,
      turnId,
      itemId: 'f1',
    });
    if ((answer.result as { decision: string }).decision !== 'accept') status = 'declined';
  }
  if (status === 'completed') writeFileSync(file, 'hello\n');
  item('item/completed', { ...change, status });
  item('item/completed', { type: 'agentMessage', id: 'm2', text: 'Done.' });
  const usage = { totalTokens: 15, inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 };
  agent.notify('thread/tokenUsage/updated', {
    threadId,
    turnId,
    tokenUsage: { total: usage, last: usage, modelContextWindow: null },
  });
  agent.notify('turn/completed', {
    threadId,
    turn: { id: turnId, status: 'completed', error: null },
  });
};
