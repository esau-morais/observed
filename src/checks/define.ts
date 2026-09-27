import type { Schema } from 'effect';
import type { Observations } from '../capture/model';
import type {
  CollectorConfig,
  EvidenceKind,
  EvidenceValue,
} from '../evidence-kinds';

export type CheckIdentity = {
  readonly kind: string;
  readonly id: string;
  readonly name: string;
  readonly scope: string;
};

// Evidence one side supplies to an evaluator. Only the declared kinds appear,
// already verified and parsed; a side missing any of them never reaches it.
export type CheckInput<K extends EvidenceKind> = {
  readonly observations: Observations;
  readonly evidence: { readonly [P in K]: EvidenceValue<P> };
};

export type Evaluation = {
  readonly outcome: 'passed' | 'failed' | 'unknown' | 'not-run';
  readonly actual: number | string | null;
  readonly detail: string;
};

export type Evaluated<K extends EvidenceKind> = CheckInput<K> & {
  readonly evaluation: Evaluation;
};

export type CheckKind<D extends CheckIdentity, K extends EvidenceKind> = {
  readonly definition: Schema.Codec<D, unknown>;
  readonly evidence: readonly K[];
  // Collectors the checks of this kind need, added when the journey does not
  // already list a collector of the same kind.
  readonly collectors: (
    definitions: readonly D[],
  ) => readonly CollectorConfig[];
  readonly expectation: (definition: D) => string;
  // Configuration problems found against the journey's collectors, reported
  // when the project loads.
  readonly validate?: (
    definition: D,
    collectors: readonly CollectorConfig[],
  ) => readonly string[];
  // Set when the rule compares the candidate with the base. In a comparison
  // whose base is unusable, missing declared evidence, or not comparable, the
  // candidate is then unknown and `evaluate` is not called for it; a preview
  // still calls it. Defining `regression` has the same effect unless this is
  // a function, which decides per definition. It must return true for every
  // definition whose verdict depends on the base, because `regression` still
  // runs on comparable pairs when it returns false.
  readonly needsBase?: true | ((definition: D) => boolean);
  // `base` is null in a preview or when the base side is unusable.
  // `comparable` is true only when the journey's comparison is available;
  // a rule reading both sides must not pass on an incomparable pair.
  readonly evaluate: (input: {
    definition: D;
    base: CheckInput<K> | null;
    candidate: CheckInput<K>;
    comparable: boolean;
  }) => { base: Evaluation | null; candidate: Evaluation };
  // Runs only for comparable captures whose evaluations are both passed or
  // failed. Defaults to base passed and candidate failed. Defining it makes
  // the kind behave as if `needsBase` were set, unless `needsBase` is a
  // function.
  readonly regression?: (input: {
    definition: D;
    base: Evaluated<K>;
    candidate: Evaluated<K>;
  }) => { detail: string } | null;
};

export function defineCheck<D extends CheckIdentity, K extends EvidenceKind>(
  kind: CheckKind<D, K>,
): CheckKind<D, K> {
  return kind;
}

export function perSide<D, K extends EvidenceKind>(
  evaluate: (definition: D, side: CheckInput<K>) => Evaluation,
) {
  return ({
    definition,
    base,
    candidate,
  }: {
    definition: D;
    base: CheckInput<K> | null;
    candidate: CheckInput<K>;
    comparable: boolean;
  }) => ({
    base: base === null ? null : evaluate(definition, base),
    candidate: evaluate(definition, candidate),
  });
}
