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
  readonly collectors: (definitions: readonly D[]) => readonly CollectorConfig[];
  readonly expectation: (definition: D) => string;
  // `base` is null in a preview or when the base side is unusable.
  readonly evaluate: (input: {
    definition: D;
    base: CheckInput<K> | null;
    candidate: CheckInput<K>;
  }) => { base: Evaluation | null; candidate: Evaluation };
  // Runs only for comparable captures whose evaluations are both passed or
  // failed. Defaults to base passed and candidate failed.
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
  }) => ({
    base: base === null ? null : evaluate(definition, base),
    candidate: evaluate(definition, candidate),
  });
}
