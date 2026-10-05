import { Data, Effect, FileSystem, Schema } from 'effect';
import type { ChangeMap, RepositoryMap } from './comparison-model';
import { redactText } from './redact';

const shortText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240));
const sentence = shortText.check(Schema.makeFilter(
  (value) => value.trim().split(/\s+/).length <= 25 && !/[\r\n]/.test(value),
  { message: 'Use one plain statement of at most 25 words' },
));
const sourcePath = Schema.String.check(Schema.makeFilter(
  (value) => value !== '' && !value.startsWith('/') && !value.includes('\\') &&
    value.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
  { message: 'Use a path relative to the snapshot' },
));
const explanation = { text: sentence, sources: Schema.NonEmptyArray(sourcePath) };
const connectionKind = Schema.Literals(['imports', 'ran-in', 'requested', 'threw-at', 'checked-by']);

export const agentDescriptionsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  blocks: Schema.Array(Schema.Struct({
    target: Schema.Union([
      Schema.Struct({ kind: Schema.Literal('file'), path: sourcePath }),
      Schema.Struct({ kind: Schema.Literal('directory'), path: sourcePath }),
    ]),
    name: shortText.check(Schema.isMaxLength(60)),
    ...explanation,
  })),
  connections: Schema.Array(Schema.Struct({
    kind: connectionKind,
    from: shortText,
    to: shortText,
    ...explanation,
  })),
}).check(Schema.makeFilter((value) => {
  const blocks = value.blocks.map(({ target }) => `${target.kind}:${target.path}`);
  const connections = value.connections.map(({ kind, from, to }) => `${kind}\u0000${from}\u0000${to}`);

  return new Set(blocks).size === blocks.length && new Set(connections).size === connections.length;
}, { message: 'Describe each block and connection once' }));

export type AgentDescriptions = typeof agentDescriptionsSchema.Type;

export class DescriptionFailure extends Data.TaggedError('DescriptionFailure')<{ message: string }> {}

export const loadAgentDescriptions = Effect.fn('loadAgentDescriptions')(function* (file: string) {
  const fs = yield* FileSystem.FileSystem;
  const content = yield* fs.readFileString(file);

  return yield* Schema.decodeUnknownEffect(Schema.fromJsonString(agentDescriptionsSchema))(
    redactText(content),
  ).pipe(Effect.mapError(() => new DescriptionFailure({
    message: 'Agent descriptions must match schema version 1 and use short statements.',
  })));
});

// Explanations may label recorded objects, never introduce map objects.
export function descriptionProblem(
  descriptions: AgentDescriptions,
  repository: RepositoryMap,
  change: ChangeMap,
): string | null {
  if (repository.kind !== 'recorded') {
    return 'Agent descriptions require a readable candidate snapshot.';
  }

  const files = new Set(repository.files.map((file) => file.path));
  const sources = [...descriptions.blocks, ...descriptions.connections].flatMap((item) => item.sources);

  if (sources.some((file) => !files.has(file))) {
    return 'An agent description names a source outside the candidate snapshot.';
  }

  if (descriptions.blocks.some(({ target }) => target.kind === 'file'
    ? !files.has(target.path)
    : ![...files].some((file) => file.startsWith(`${target.path}/`)))) {
    return 'An agent description names a block outside the candidate snapshot.';
  }

  const connections = [repository.map, change].flatMap((map) => map.kind === 'recorded' ? map.connections : []);

  if (descriptions.connections.some((description) => !connections.some((connection) =>
    connection.kind === description.kind && connection.from === description.from && connection.to === description.to,
  ))) {
    return 'An agent description names a connection absent from the recorded maps.';
  }

  return null;
}
