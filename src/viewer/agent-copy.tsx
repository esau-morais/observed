import * as stylex from '@stylexjs/stylex';
import { useState, type ButtonHTMLAttributes } from 'react';
import type { Comparison } from '../comparison-model';
import { agentText } from './agent-text';
import { fonts, geometry, media, motion } from './constants.stylex';
import { colors, effects } from './tokens.stylex';

const styles = stylex.create({
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  row: { alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 12 },
  button: {
    alignItems: 'center',
    appearance: 'none',
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    cursor: 'pointer',
    display: 'inline-flex',
    fontFamily: fonts.sans,
    fontSize: '0.875rem',
    fontWeight: 500,
    gap: 8,
    justifyContent: 'center',
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
    minHeight: geometry.target,
    outlineColor: {
      default: 'transparent',
      ':focus-visible': colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
    paddingBlock: 12,
    paddingInline: 16,
    transform: {
      default: 'translateY(0)',
      ':active': { default: 'translateY(1px)', [media.reduceMotion]: 'none' },
    },
    transitionDuration: { default: motion.fast, [media.reduceMotion]: '0ms' },
    transitionProperty: 'background-color, color, transform',
    transitionTimingFunction: motion.ease,
  },
  primary: {
    backgroundColor: {
      default: colors.action,
      [media.hover]: { default: colors.action, ':hover': colors.actionHover },
    },
    borderColor: colors.actionStroke,
    boxShadow: {
      default: effects.buttonRest,
      [media.hover]: {
        default: effects.buttonRest,
        ':hover': effects.buttonHover,
      },
      ':active': effects.buttonPressed,
      [media.forcedColors]: 'none',
    },
    color: colors.onAction,
  },
  secondary: {
    backgroundColor: {
      default: colors.surface,
      [media.hover]: { default: colors.surface, ':hover': colors.surfaceMuted },
    },
    borderColor: colors.borderControl,
    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.24)',
    color: colors.text,
  },
  status: { color: colors.textSecondary, fontSize: '0.8125rem' },
  summary: {
    alignContent: 'center',
    color: colors.textSecondary,
    cursor: 'pointer',
    fontSize: '0.875rem',
    minHeight: geometry.target,
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  preview: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: geometry.radius,
    borderStyle: 'solid',
    borderWidth: 1,
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    margin: 0,
    maxHeight: '24rem',
    overflow: 'auto',
    padding: 16,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
});

function Button({
  primary = false,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'style'> & {
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      {...rest}
      {...stylex.props(
        styles.button,
        primary ? styles.primary : styles.secondary,
      )}
    />
  );
}

export function AgentCopy({ result }: { result: Comparison }) {
  const [status, setStatus] = useState('');
  const text = agentText(result);
  const copy = (label: string, value: string) => {
    const blocked = () =>
      setStatus(
        'The browser blocked the clipboard. Select the preview text and copy it.',
      );

    try {
      navigator.clipboard
        .writeText(value)
        .then(() => setStatus(`${label} copied.`), blocked);
    } catch {
      blocked();
    }
  };

  return (
    <div {...stylex.props(styles.stack)}>
      <div {...stylex.props(styles.row)}>
        <Button primary onClick={() => copy('Agent text', text)}>
          Copy for agent
        </Button>
        <Button
          onClick={() =>
            copy('Result JSON', `${JSON.stringify(result, null, 2)}\n`)
          }
        >
          Copy JSON
        </Button>
        <span role="status" {...stylex.props(styles.status)}>
          {status}
        </span>
      </div>
      <details>
        <summary {...stylex.props(styles.summary)}>
          Preview the agent text
        </summary>
        <pre
          tabIndex={0}
          aria-label="Agent text"
          {...stylex.props(styles.preview)}
        >
          {text}
        </pre>
      </details>
    </div>
  );
}
