import { Effect, Schema } from 'effect';
import {
  accessibilitySchema,
  count,
  impactSchema,
  parseTreeLine,
  targetSchema,
  type Accessibility,
  type TreeNode,
} from '../../accessibility';
import { EvidenceUnavailable, type Collector } from './define';

const resultSchema = <I extends Schema.Constraint, N extends Schema.Constraint>(
  impact: I,
  node: N,
) =>
  Schema.Struct({
    id: Schema.NonEmptyString,
    impact,
    help: Schema.String,
    helpUrl: Schema.String,
    nodeCount: count,
    nodes: Schema.Array(node),
  });

// agent-browser 0.38.1 `a11y --json`; fields Observed does not use are ignored.
export const auditSchema = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Struct({
    axeVersion: Schema.NonEmptyString,
    counts: Schema.Struct({
      violations: count,
      incomplete: count,
      passes: count,
      inapplicable: count,
    }),
    violations: Schema.Array(
      resultSchema(
        impactSchema,
        Schema.Struct({
          target: targetSchema,
          html: Schema.String,
          failureSummary: Schema.String,
        }),
      ),
    ),
    incomplete: Schema.Array(
      resultSchema(
        Schema.NullOr(impactSchema),
        Schema.Struct({ target: targetSchema }),
      ),
    ),
  }),
});

const scopedSnapshotSchema = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Struct({ snapshot: Schema.String }),
});

export const maxTreeLookups = 50;

const genericElement = /^<(?:div|span)\b(?![^>]*\srole=)/iu;

export const recordAccessibility = Effect.fnUntraced(function* <E, R>(
  audit: Effect.Effect<string, E, R>,
  snapshot: (selector: string) => Effect.Effect<string, unknown, R>,
) {
  const output = yield* audit.pipe(Effect.result);

  if (output._tag === 'Failure') {
    return yield* new EvidenceUnavailable({
      reason: 'agent-browser a11y failed; see transcript.jsonl',
    });
  }

  const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(auditSchema))(
    output.success,
  );

  if (parsed._tag === 'None') {
    return yield* new EvidenceUnavailable({
      reason: 'agent-browser a11y output was not recognized; see a11y.json',
    });
  }

  const data = parsed.value.data;
  let lookups = 0;

  // A scoped snapshot starts with the element's own node, or with its first
  // descendant when the tree omits the element. The tree omits a div or span
  // without a role, so a descendant's node is never reported as theirs.
  const lookup = Effect.fnUntraced(function* ({
    target,
    html,
  }: {
    target: typeof targetSchema.Type;
    html: string;
  }) {
    const [selector, ...frames] = target;

    if (genericElement.test(html)) {
      return {
        kind: 'unavailable',
        reason:
          'The accessibility tree has no node of its own for a div or span without a role',
      } satisfies TreeNode;
    }

    if (typeof selector !== 'string' || frames.length > 0) {
      return {
        kind: 'unavailable',
        reason:
          'The element is inside a frame or shadow root, which a scoped snapshot cannot reach',
      } satisfies TreeNode;
    }

    if (selector.startsWith('-')) {
      return {
        kind: 'unavailable',
        reason: 'The selector would be read as a command option',
      } satisfies TreeNode;
    }

    if (lookups >= maxTreeLookups) {
      return {
        kind: 'unavailable',
        reason: `Not looked up; Observed reads the tree for at most ${maxTreeLookups} elements per capture`,
      } satisfies TreeNode;
    }

    lookups += 1;

    const result = yield* snapshot(selector).pipe(Effect.result);
    const scoped =
      result._tag === 'Success'
        ? Schema.decodeUnknownOption(
            Schema.fromJsonString(scopedSnapshotSchema),
          )(result.success)
        : undefined;
    const line = scoped?._tag === 'Some' ? scoped.value.data.snapshot : '';

    if (line === '') {
      return {
        kind: 'unavailable',
        reason:
          'agent-browser returned no accessibility tree node at or inside this element; see transcript.jsonl',
      } satisfies TreeNode;
    }

    const node = parseTreeLine(line.split('\n')[0] ?? '');

    return node.kind === 'recorded' && node.role === 'StaticText'
      ? ({
          kind: 'unavailable',
          reason:
            'The accessibility tree has no node of its own for this element, only its text',
        } satisfies TreeNode)
      : node;
  });

  const violations = yield* Effect.forEach(data.violations, (violation) =>
    Effect.gen(function* () {
      return {
        rule: violation.id,
        impact: violation.impact,
        help: violation.help,
        helpUrl: violation.helpUrl,
        nodeCount: violation.nodeCount,
        nodes: yield* Effect.forEach(violation.nodes, (node) =>
          Effect.map(lookup(node), (tree) => ({ ...node, tree })),
        ),
      };
    }),
  );

  return {
    engine: { name: 'axe-core', version: data.axeVersion },
    counts: data.counts,
    violations,
    incomplete: data.incomplete.map((item) => ({
      rule: item.id,
      impact: item.impact,
      help: item.help,
      helpUrl: item.helpUrl,
      nodeCount: item.nodeCount,
      nodes: item.nodes,
    })),
  } satisfies Accessibility;
});

export const accessibility: Collector<'accessibility'> = {
  phase: 'journey',
  collect: (_config, context) =>
    recordAccessibility(
      context.saveOutput('a11y', 'a11y.json', ['a11y']),
      (selector) => context.browser(['snapshot', '-s', selector]),
    ).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(accessibilitySchema)),
      Effect.catchTag('SchemaError', () =>
        Effect.fail(
          new EvidenceUnavailable({
            reason:
              'agent-browser a11y findings are inconsistent; see a11y.json',
          }),
        ),
      ),
    ),
};
