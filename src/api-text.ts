import {
  compareContract,
  describeFieldChange,
  type ContractComparison,
} from './api-contract';
import type { SideArtifact } from './comparison-model';
import type { EvidenceValue, EvidenceView } from './evidence-kinds';

type Recorded = EvidenceValue<'api'>['operations'][number];

export const apiClaimLimit =
  'Observed sent each operation once, in order, straight to the app it started for this capture, after the browser journey. A response covers that request and the data the app held then. Field changes are observations; the checks decide the result.';

const bodyLabels = {
  json: 'JSON body',
  text: 'text body',
  empty: 'empty body',
  'too-large': 'body too large to record',
} satisfies Record<
  Extract<Recorded['result'], { kind: 'response' }>['body']['kind'],
  string
>;

export function describeResponse(operation: Recorded | null): string {
  if (operation === null) {
    return 'Not recorded';
  }

  if (operation.result.kind === 'failed') {
    return `No response. ${operation.result.reason}`;
  }

  return `${operation.result.status}, ${bodyLabels[operation.result.body.kind]}, ${operation.durationMs} ms`;
}

export type ApiRow = {
  readonly id: string;
  readonly request: string;
  readonly base: Recorded | null;
  readonly candidate: Recorded | null;
  // Null in a preview or when the base has no usable record.
  readonly contract: ContractComparison | null;
};

function recorded(view: EvidenceView<'api'> | null): readonly Recorded[] {
  return view?.status === 'recorded' ? view.value.operations : [];
}

// One row per operation id in configuration order, candidate first.
export function apiRows(
  base: EvidenceView<'api'> | null,
  candidate: EvidenceView<'api'>,
): ApiRow[] {
  const before = recorded(base);
  const after = recorded(candidate);
  const ids = [
    ...new Set([...after, ...before].map((item) => item.request.id)),
  ];

  return ids.map((id) => {
    const beforeItem = before.find((item) => item.request.id === id) ?? null;
    const afterItem = after.find((item) => item.request.id === id) ?? null;
    const request = afterItem?.request ?? beforeItem?.request;

    return {
      id,
      request: request === undefined ? id : `${request.method} ${request.path}`,
      base: beforeItem,
      candidate: afterItem,
      contract:
        beforeItem === null || afterItem === null
          ? null
          : compareContract(beforeItem, afterItem),
    };
  });
}

export function describeContract(contract: ContractComparison): string[] {
  if (contract.kind === 'unavailable') {
    return [`Fields not compared. ${contract.reason}.`];
  }

  return contract.changes.length === 0
    ? ['No field changes']
    : contract.changes.map(describeFieldChange);
}

export function describeStatusChange(row: ApiRow): string | null {
  const before = row.base?.result;
  const after = row.candidate?.result;

  return before?.kind === 'response' &&
    after?.kind === 'response' &&
    before.status !== after.status
    ? `Status changed from ${before.status} to ${after.status}`
    : null;
}

export type RecordFile =
  | { readonly kind: 'recorded'; readonly path: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

export function recordFile(artifacts: readonly SideArtifact[]): RecordFile {
  const artifact = artifacts.find((item) => item.id === 'evidence-api');

  if (artifact === undefined) {
    return { kind: 'unavailable', reason: 'The file is not in the capture' };
  }

  return artifact.integrity === 'verified'
    ? { kind: 'recorded', path: artifact.path }
    : { kind: 'unavailable', reason: artifact.reason };
}
