import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { loadItems, title } from './duplicate';
import type { Item } from './items';
import { colors } from './tokens.stylex';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; items: readonly Item[] }
  | { kind: 'failed' };

function statusText(state: LoadState): string {
  switch (state.kind) {
    case 'idle':
      return 'Ready to load';
    case 'loading':
      return 'Loading items';
    case 'loaded':
      return 'Items loaded';
    case 'failed':
      return 'Could not load items';
  }
}

export function App() {
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const inFlight = useRef(false);

  function handleLoad() {
    if (inFlight.current) {
      return;
    }

    inFlight.current = true;

    setState({ kind: 'loading' });

    loadItems()
      .then((items) => {
        inFlight.current = false;

        setState({ kind: 'loaded', items });
      })
      .catch(() => {
        inFlight.current = false;

        setState({ kind: 'failed' });
      });
  }

  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.panel)} aria-labelledby="fixture-title">
        <p {...stylex.props(styles.eyebrow)}>Observed / controlled fixture</p>
        <h1 id="fixture-title" {...stylex.props(styles.title)}>
          {title}
        </h1>
        <p {...stylex.props(styles.description)}>
          Load a small collection from the local items API.
        </p>
        <button
          type="button"
          disabled={state.kind === 'loading'}
          onClick={handleLoad}
          {...stylex.props(styles.button)}
        >
          Load items
        </button>
        <p role="status" {...stylex.props(styles.status)}>
          {statusText(state)}
        </p>
        {state.kind === 'loaded' ? (
          <div>
            <h2 {...stylex.props(styles.itemsHeading)}>
              {state.items.length} items
            </h2>
            <ul {...stylex.props(styles.list)}>
              {state.items.map((item) => (
                <li key={item.id} {...stylex.props(styles.item)}>
                  {item.name}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </main>
  );
}

const styles = stylex.create({
  page: {
    backgroundColor: colors.canvas,
    boxSizing: 'border-box',
    color: colors.text,
    fontFamily: 'Geist, system-ui, sans-serif',
    lineHeight: 1.5,
    minHeight: '100dvh',
    paddingBlock: 64,
    paddingInline: 20,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    marginInline: 'auto',
    maxWidth: 560,
    padding: 24,
  },
  eyebrow: {
    color: colors.textSecondary,
    fontFamily: '"Geist Mono", ui-monospace, monospace',
    fontSize: 12,
    marginBlock: 0,
  },
  title: {
    fontSize: 32,
    fontWeight: 500,
    letterSpacing: '-0.02em',
    lineHeight: 1.2,
    marginBlock: 16,
  },
  description: {
    color: colors.textSecondary,
    marginBlock: 24,
  },
  button: {
    backgroundColor: {
      default: colors.action,
      '@media (hover: hover)': {
        default: colors.action,
        ':hover:not(:disabled)': colors.actionHover,
      },
    },
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 12,
    borderStyle: 'solid',
    borderWidth: 1,
    boxShadow: {
      default:
        'inset 0 1px 0 rgba(255,255,255,0.24), 0 0 0 1px #172B33, 0 3px 6px rgba(8,17,18,0.20)',
      ':disabled': 'none',
      '@media (forced-colors: active)': 'none',
    },
    color: colors.onAction,
    cursor: { default: 'pointer', ':disabled': 'wait' },
    fontFamily: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    minHeight: 44,
    outlineColor: {
      default: colors.focus,
      '@media (forced-colors: active)': 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingInline: 16,
  },
  status: {
    marginBlock: 24,
  },
  itemsHeading: {
    fontSize: 16,
    fontWeight: 500,
    marginBlock: 0,
  },
  list: {
    listStyleType: 'none',
    marginBottom: 0,
    marginTop: 12,
    padding: 0,
  },
  item: {
    borderTopColor: colors.border,
    borderTopStyle: 'solid',
    borderTopWidth: 1,
    paddingBlock: 12,
  },
});
