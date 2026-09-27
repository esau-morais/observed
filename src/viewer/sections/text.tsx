import * as stylex from '@stylexjs/stylex';
import { fonts, media } from '../constants.stylex';
import { colors } from '../tokens.stylex';
import type { SectionSide, ViewerSection } from './define';

const styles = stylex.create({
  grid: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.desktop]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  stack: { display: 'grid', gap: 12, minWidth: 0 },
  heading: { fontSize: '1rem', fontWeight: 500 },
  list: { display: 'grid', gap: 8, marginBlock: 0, paddingInlineStart: 20 },
  mono: { fontFamily: fonts.mono, fontSize: '0.8125rem' },
  muted: { color: colors.textSecondary },
});

function Elements({
  label,
  side,
}: {
  label: string;
  side: SectionSide<'text'>;
}) {
  return (
    <section {...stylex.props(styles.stack)} aria-label={`${label} text`}>
      <h3 {...stylex.props(styles.heading)}>{label}</h3>
      {side.evidence.status === 'unavailable' ? (
        <p {...stylex.props(styles.muted)}>
          Unavailable: {side.evidence.reason}
        </p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {side.evidence.value.elements.map((element) => (
            <li key={element.selector}>
              <span {...stylex.props(styles.mono)}>{element.selector}</span>:{' '}
              {element.count} element(s); text:{' '}
              {element.value === null ? (
                'not read'
              ) : (
                <span {...stylex.props(styles.mono)}>
                  {JSON.stringify(element.value)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export const TextSection: ViewerSection<'text'> = ({ base, candidate }) => (
  <div {...stylex.props(styles.grid)}>
    {base !== null && <Elements label="Before" side={base} />}
    <Elements
      label={base === null ? 'Current capture' : 'After'}
      side={candidate}
    />
  </div>
);
