import type { EvidenceValue } from '@observed/judge';
import { Effect } from 'effect';
import type { Page } from 'playwright';
import { BrowserFailure, browserCall } from './define';

export const collectText = Effect.fnUntraced(function* <E>({
  page,
  selectors,
  save,
  hasCredentials,
}: {
  page: Page;
  selectors: readonly string[];
  save: (
    index: number,
    raw: { selector: string; count: number; text: string | null },
  ) => Effect.Effect<void, E>;
  hasCredentials: (value: string) => boolean;
}) {
  const elements: EvidenceValue<'text'>['elements'][number][] = [];

  for (const [index, selector] of selectors.entries()) {
    const locator = page.locator(selector);
    const count = yield* browserCall(`Counting ${selector}`, () => locator.count());
    const value =
      count === 1 ? yield* browserCall(`Reading ${selector}`, () => locator.innerText()) : null;

    if (value !== null && hasCredentials(value)) {
      return yield* new BrowserFailure({
        category: 'application',
        message:
          'Text observation contains credentials. Exact-text evaluation and screenshot capture are unavailable.',
      });
    }

    yield* save(index + 1, { selector, count, text: value });
    elements.push({ selector, count, value });
  }

  return { elements } satisfies EvidenceValue<'text'>;
});
