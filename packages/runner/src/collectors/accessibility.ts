import { parseTreeLine, type EvidenceValue } from '@observed/judge';
import axe from 'axe-core';
import { Effect, Option, Schema } from 'effect';
import type { Page } from 'playwright';
import { EvidenceUnavailable } from './define';

type Accessibility = EvidenceValue<'accessibility'>;
type TreeNode = Accessibility['violations'][number]['nodes'][number]['tree'];

const impact = Schema.Literals(['minor', 'moderate', 'serious', 'critical']);
const target = Schema.NonEmptyArray(
  Schema.Union([Schema.String, Schema.NonEmptyArray(Schema.String)]),
);
const rule = <I extends Schema.Top, N extends Schema.Top>(ruleImpact: I, node: N) =>
  Schema.Struct({
    id: Schema.NonEmptyString,
    impact: ruleImpact,
    help: Schema.String,
    helpUrl: Schema.String,
    nodes: Schema.Array(node),
  });

const auditSchema = Schema.Struct({
  testEngine: Schema.Struct({ name: Schema.Literal('axe-core'), version: Schema.NonEmptyString }),
  violations: Schema.Array(
    rule(impact, Schema.Struct({ target, html: Schema.String, failureSummary: Schema.String })),
  ),
  incomplete: Schema.Array(rule(Schema.NullOr(impact), Schema.Struct({ target }))),
  passes: Schema.Array(Schema.Unknown),
  inapplicable: Schema.Array(Schema.Unknown),
});

export const maxTreeLookups = 50;

const omittedRoles = new Set(['none', 'presentation', 'generic']);

function omitted(html: string): boolean {
  const opening = /^<([a-z][\w-]*)([^>]*)>?/iu.exec(html);
  const tag = opening?.[1]?.toLowerCase();
  const role = [
    ...(opening?.[2] ?? '').matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/gu),
  ]
    .map((attribute) => ({
      name: attribute[1]?.toLowerCase(),
      value: attribute[2] ?? attribute[3] ?? attribute[4],
    }))
    .find((attribute) => attribute.name === 'role')
    ?.value?.trim()
    .toLowerCase();

  return role === undefined ? tag === 'div' || tag === 'span' : omittedRoles.has(role);
}

const unavailable = (reason: string): TreeNode => ({ kind: 'unavailable', reason });

export const collectAccessibility = Effect.fnUntraced(function* <E>({
  page,
  save,
}: {
  page: Page;
  save: (raw: unknown) => Effect.Effect<void, E>;
}) {
  const raw = yield* Effect.tryPromise(async () => {
    await page.evaluate(axe.source);

    return page.evaluate<unknown>('axe.run(document)');
  }).pipe(
    Effect.mapError(
      () => new EvidenceUnavailable({ reason: 'axe-core could not run in the page' }),
    ),
  );

  yield* save(raw);

  const audit = yield* Schema.decodeUnknownEffect(auditSchema)(raw).pipe(
    Effect.mapError(
      () =>
        new EvidenceUnavailable({ reason: 'axe-core output was not recognized; see a11y.json' }),
    ),
  );
  let lookups = 0;

  // A scoped snapshot starts with the element's own node, so elements the
  // tree omits are not looked up.
  const lookup = Effect.fnUntraced(function* ({
    target: [selector, ...frames],
    html,
  }: {
    target: typeof target.Type;
    html: string;
  }) {
    if (omitted(html)) {
      return unavailable(
        'The accessibility tree has no node of its own for a div or span without a role, or for an element whose role removes it',
      );
    }

    if (typeof selector !== 'string' || frames.length > 0) {
      return unavailable(
        'The element is inside a frame or shadow root, which a scoped snapshot cannot reach',
      );
    }

    if (lookups >= maxTreeLookups) {
      return unavailable(
        `Not looked up; Observed reads the tree for at most ${maxTreeLookups} elements per capture`,
      );
    }

    lookups += 1;

    const snapshot = yield* Effect.tryPromise(() => page.locator(selector).ariaSnapshot()).pipe(
      Effect.option,
    );
    const line = Option.getOrElse(snapshot, () => '').split('\n')[0] ?? '';

    if (line === '') {
      return unavailable('Playwright returned no accessibility tree node for this element');
    }

    const node = parseTreeLine(line);

    return node.kind === 'recorded' && node.role === 'text'
      ? unavailable('The accessibility tree has no node of its own for this element, only its text')
      : node;
  });

  return {
    engine: { name: 'axe-core', version: audit.testEngine.version },
    counts: {
      violations: audit.violations.length,
      incomplete: audit.incomplete.length,
      passes: audit.passes.length,
      inapplicable: audit.inapplicable.length,
    },
    violations: yield* Effect.forEach(audit.violations, (violation) =>
      Effect.gen(function* () {
        return {
          rule: violation.id,
          impact: violation.impact,
          help: violation.help,
          helpUrl: violation.helpUrl,
          nodeCount: violation.nodes.length,
          nodes: yield* Effect.forEach(violation.nodes, (node) =>
            Effect.map(lookup(node), (tree) => ({ ...node, tree })),
          ),
        };
      }),
    ),
    incomplete: audit.incomplete.map((item) => ({
      rule: item.id,
      impact: item.impact,
      help: item.help,
      helpUrl: item.helpUrl,
      nodeCount: item.nodes.length,
      nodes: item.nodes,
    })),
  } satisfies Accessibility;
});
