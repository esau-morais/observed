import type { Observed, Source } from './capture/model';

export function describeRevision(revision: Source['revision']): string {
  if (revision.kind === 'commit') {
    return revision.commit;
  }

  return revision.head.kind === 'commit'
    ? `worktree on ${revision.head.commit}`
    : `worktree; HEAD unavailable: ${revision.head.reason}`;
}

export function describeObserved(observed: Observed): string {
  const source = observed.source;

  if (source.kind === 'unavailable') {
    return `${observed.version}; source commit unavailable: ${source.reason}`;
  }

  return `${observed.version}; commit ${source.commit}${source.trackedChanges ? ' with uncommitted tracked changes' : ''}`;
}
