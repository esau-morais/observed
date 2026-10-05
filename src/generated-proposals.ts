import type { ChangeMap, Journey } from './comparison-model';

export function proposeSaving(
  journey: Journey,
  index: number,
  map: ChangeMap,
  savedCount: number,
): Journey {
  if (journey.generated === undefined || map.kind !== 'recorded') {
    return journey;
  }

  const reached = new Set(
    map.connections
      .filter(
        (connection) =>
          connection.kind === 'ran-in' &&
          connection.to === `journey:${index + 1}`,
      )
      .map((connection) => connection.from),
  );
  const [first, ...rest] = map.blocks.flatMap((block) =>
    block.kind === 'file' && reached.has(block.id) ? [block.path] : [],
  );

  return first === undefined
    ? journey
    : {
        ...journey,
        savingProposal: {
          action: savedCount >= 3 ? 'replace' : 'save',
          files: [first, ...rest],
        },
      };
}

export function savingProposalText(journey: Journey): string {
  if (journey.savingProposal === undefined) {
    return 'No saving proposal: coverage has not shown that this journey ran changed lines.';
  }

  return journey.savingProposal.action === 'replace'
    ? 'Proposal: replace one of the three saved journeys with this journey. No saved journey was changed.'
    : 'Proposal: save this journey for future changes. No saved journey was changed.';
}
