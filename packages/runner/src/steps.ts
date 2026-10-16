import type { Step } from '@observed/judge';
import type { Page } from 'playwright';

type AriaRole = Parameters<Page['getByRole']>[0];

const ariaRoles: ReadonlySet<string> = new Set<AriaRole>([
  'alert',
  'alertdialog',
  'application',
  'article',
  'banner',
  'blockquote',
  'button',
  'caption',
  'cell',
  'checkbox',
  'code',
  'columnheader',
  'combobox',
  'complementary',
  'contentinfo',
  'definition',
  'deletion',
  'dialog',
  'directory',
  'document',
  'emphasis',
  'feed',
  'figure',
  'form',
  'generic',
  'grid',
  'gridcell',
  'group',
  'heading',
  'img',
  'insertion',
  'link',
  'list',
  'listbox',
  'listitem',
  'log',
  'main',
  'marquee',
  'math',
  'meter',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'navigation',
  'none',
  'note',
  'option',
  'paragraph',
  'presentation',
  'progressbar',
  'radio',
  'radiogroup',
  'region',
  'row',
  'rowgroup',
  'rowheader',
  'scrollbar',
  'search',
  'searchbox',
  'separator',
  'slider',
  'spinbutton',
  'status',
  'strong',
  'subscript',
  'superscript',
  'switch',
  'tab',
  'table',
  'tablist',
  'tabpanel',
  'term',
  'textbox',
  'time',
  'timer',
  'toolbar',
  'tooltip',
  'tree',
  'treegrid',
  'treeitem',
]);

const isAriaRole = (role: string): role is AriaRole => ariaRoles.has(role);

export const playwrightNetworkIdleMs = 500;
export const stepTimeoutMs = 20_000;

export function stepTarget(step: Step): string | null {
  switch (step.kind) {
    case 'navigate':
      return step.path;
    case 'click':
    case 'fill':
    case 'wait-selector':
      return step.selector;
    case 'click-role':
      return `${step.role} ${JSON.stringify(step.name)}`;
    case 'press':
      return step.key;
    case 'wait-text':
      return JSON.stringify(step.text);
    case 'network-idle':
      return null;
  }
}

export async function runStep({
  page,
  step,
  url,
  fillValues,
  idle,
}: {
  page: Page;
  step: Step;
  url: string;
  fillValues: ReadonlyMap<string, string>;
  idle: (options: { quietMs: number; timeoutMs: number }) => Promise<boolean>;
}): Promise<void> {
  switch (step.kind) {
    case 'navigate':
      await page.goto(new URL(step.path, url).toString());
      return;
    case 'click':
      await page.locator(step.selector).click();
      return;
    case 'click-role':
      if (!isAriaRole(step.role)) {
        throw new Error(`${step.role} is not an ARIA role`);
      }

      await page.getByRole(step.role, { name: step.name, exact: true }).click();
      return;
    case 'fill': {
      const value = typeof step.value === 'string' ? step.value : fillValues.get(step.value.env);

      if (value === undefined) {
        throw new Error('A fill value from the environment was not resolved');
      }

      await page.locator(step.selector).fill(value);
      return;
    }
    case 'press':
      await page.keyboard.press(step.key);
      return;
    case 'wait-text':
      await page.getByText(step.text).first().waitFor();
      return;
    case 'wait-selector':
      await page.locator(step.selector).first().waitFor();
      return;
    case 'network-idle':
      if (!(await idle({ quietMs: playwrightNetworkIdleMs, timeoutMs: stepTimeoutMs }))) {
        throw new Error(`The network did not go idle within ${stepTimeoutMs / 1000} s`);
      }
  }
}
