import { Schema } from 'effect';

export const Agent = Schema.Literals(['claude-code', 'codex', 'opencode', 'muse']);
export type Agent = typeof Agent.Type;
