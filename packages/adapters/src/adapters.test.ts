import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BunServices } from '@effect/platform-bun';
import { Effect, Exit, Stream } from 'effect';
import { afterEach, describe, expect, it } from 'vitest';
import {
  acp,
  allowAll,
  claude,
  codex,
  denyAll,
  type Adapter,
  type AgentEvent,
  type Approve,
} from './index';
import { fakeClaude } from './testing/fake-claude';
import type { Mode } from './testing/wire';

const fixture = (name: string) => fileURLToPath(new URL(`./testing/${name}`, import.meta.url));

const agents: Record<string, (mode: Mode, approve: Approve) => Adapter> = {
  acp: (mode, approve) =>
    acp({ agent: 'opencode', command: ['bun', fixture('fake-acp.ts'), mode], approve }),
  codex: (mode, approve) => codex({ command: ['bun', fixture('fake-codex.ts'), mode], approve }),
  claude: (mode, approve) => claude({ executable: 'claude', query: fakeClaude(mode), approve }),
};

const workspaces: Array<string> = [];
afterEach(() => {
  for (const dir of workspaces.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const workspace = () => {
  const dir = mkdtempSync(join(tmpdir(), 'observed-adapters-'));
  workspaces.push(dir);
  return dir;
};

const run = (adapter: Adapter, cwd: string) =>
  Effect.runPromiseExit(
    adapter
      .run({ cwd, prompt: 'Create hello.txt containing hello.' })
      .pipe(Stream.runCollect, Effect.provide(BunServices.layer)),
  );

const shape = (event: AgentEvent) => {
  switch (event._tag) {
    case 'Message':
      return event;
    case 'Tool':
      return { _tag: event._tag, kind: event.kind, status: event.status, paths: event.paths };
    case 'Usage':
      return { _tag: event._tag };
    case 'Finished':
      return { _tag: event._tag, stopReason: event.stopReason };
  }
};

describe.each(Object.keys(agents))('%s', (name) => {
  const make = agents[name];
  if (make === undefined) throw new Error(name);

  // A change has to read the same whichever agent made it, or the same diff
  // would produce different evidence.
  it('reports a scripted edit as whole events in order', async () => {
    const cwd = workspace();
    const exit = await run(make('edit', allowAll), cwd);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value.map(shape)).toEqual([
      { _tag: 'Message', text: "I'll create hello.txt." },
      { _tag: 'Tool', kind: 'edit', status: 'completed', paths: ['hello.txt'] },
      { _tag: 'Message', text: 'Done.' },
      { _tag: 'Usage' },
      { _tag: 'Finished', stopReason: 'completed' },
    ]);
  });

  it('reports a tool call the turn left open as unfinished', async () => {
    const exit = await run(make('stop', allowAll), workspace());
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value.map(shape)).toContainEqual({
      _tag: 'Tool',
      kind: 'edit',
      status: 'unfinished',
      paths: ['hello.txt'],
    });
  });

  it('declines an edit the approval policy refuses', async () => {
    const cwd = workspace();
    const exit = await run(make('ask', denyAll), cwd);
    if (Exit.isFailure(exit)) throw new Error(String(exit.cause));
    expect(exit.value.map(shape)).toContainEqual({
      _tag: 'Tool',
      kind: 'edit',
      status: 'declined',
      paths: ['hello.txt'],
    });
    expect(existsSync(join(cwd, 'hello.txt'))).toBe(false);
  });
});

describe.each(['acp', 'codex'])('%s over stdio', (name) => {
  it('fails the run when the agent dies mid-turn instead of waiting forever', async () => {
    const make = agents[name];
    if (make === undefined) throw new Error(name);
    const exit = await run(make('crash', allowAll), workspace());
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain('fake agent crashed');
  });
});

describe('claude', () => {
  // The Agent SDK terms rule out offering claude.ai login, so without the
  // user's own Claude Code or an API key there is nothing Observed may run.
  it('refuses to run without an installed Claude Code or an API key', async () => {
    const calls = { count: 0 };
    const exit = await run(
      claude({ env: { PATH: '' }, query: fakeClaude('edit', calls), approve: allowAll }),
      workspace(),
    );
    expect(Exit.isFailure(exit) && String(exit.cause)).toContain('ANTHROPIC_API_KEY');
    expect(calls.count).toBe(0);
  });
});
