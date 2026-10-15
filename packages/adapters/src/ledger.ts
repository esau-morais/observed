import { workspacePath, type AgentEvent, type ToolKind, type ToolStatus } from './events';

type Tool = Extract<AgentEvent, { _tag: 'Tool' }>;

// Holds tool calls until they finish, so each one is reported once and a call
// the turn left open is reported as unfinished rather than dropped.
export const makeLedger = (cwd: string) => {
  const open = new Map<string, Tool>();
  const declined = new Set<string>();
  const done = new Set<string>();

  const note = (
    id: string,
    fields: { kind?: ToolKind; title?: string; paths?: ReadonlyArray<string> },
  ) => {
    if (done.has(id)) return;
    const known = open.get(id) ?? {
      _tag: 'Tool',
      id,
      kind: 'other',
      title: id,
      status: 'unfinished',
      paths: [],
    };
    open.set(id, {
      ...known,
      ...(fields.kind === undefined ? {} : { kind: fields.kind }),
      ...(fields.title === undefined || fields.title === '' ? {} : { title: fields.title }),
      ...(fields.paths === undefined || fields.paths.length === 0
        ? {}
        : { paths: fields.paths.map((path) => workspacePath(cwd, path)) }),
    });
  };

  const finish = (id: string, status: Exclude<ToolStatus, 'unfinished'>): Tool | undefined => {
    const tool = open.get(id);
    if (tool === undefined) return undefined;
    open.delete(id);
    done.add(id);
    return { ...tool, status: declined.has(id) ? 'declined' : status };
  };

  const decline = (id: string) => {
    declined.add(id);
  };

  const rest = (): Array<Tool> => {
    const left = [...open.values()].map((tool) =>
      declined.has(tool.id) ? { ...tool, status: 'declined' as const } : tool,
    );
    open.clear();
    return left;
  };

  return { note, finish, decline, rest, get: (id: string) => open.get(id) };
};
