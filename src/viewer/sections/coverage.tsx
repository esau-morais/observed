import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { fonts, geometry, media } from '../constants.stylex';
import { colors } from '../tokens.stylex';
import { SubHeading } from '../heading';
import { lineCount } from '../../report-sections/coverage';
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
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  count: { fontVariantNumeric: 'tabular-nums' },
  muted: { color: colors.textSecondary },
  caption: { color: colors.textMuted, fontSize: '0.8125rem', margin: 0 },
  missing: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    padding: 16,
  },
});

function Files({
  label,
  side,
}: {
  label: string;
  side: SectionSide<'coverage'>;
}) {
  const withoutId = useId();

  if (side.evidence.status === 'unavailable') {
    return (
      <section {...stylex.props(styles.stack)} aria-label={`${label} coverage`}>
        <SubHeading xstyle={styles.heading}>{label}</SubHeading>
        <p {...stylex.props(styles.missing)}>
          Unavailable: {side.evidence.reason}
        </p>
      </section>
    );
  }

  const { files, scripts } = side.evidence.value;
  const missing = scripts.flatMap((script) =>
    script.kind === 'unavailable'
      ? [{ name: script.script, reason: script.reason }]
      : script.excluded.map((file) => ({
          name: `${file.path} in ${script.script}`,
          reason: file.reason,
        })),
  );

  return (
    <section {...stylex.props(styles.stack)} aria-label={`${label} coverage`}>
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      {files.length === 0 ? (
        <p {...stylex.props(styles.muted)}>
          No file in the source snapshot has coverage.
        </p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {files.map((file) => (
            <li key={file.path}>
              <span {...stylex.props(styles.mono)}>{file.path}</span>:{' '}
              <span {...stylex.props(styles.count)}>
                {lineCount(file.executed)}
              </span>{' '}
              lines ran,{' '}
              <span {...stylex.props(styles.count)}>
                {lineCount(file.unexecuted)}
              </span>{' '}
              did not run
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 && (
        <>
          <p {...stylex.props(styles.caption)} id={withoutId}>
            Without coverage
          </p>
          <ul {...stylex.props(styles.list)} aria-labelledby={withoutId}>
            {missing.map((item) => (
              <li key={item.name}>
                <span {...stylex.props(styles.mono)}>{item.name}</span>:{' '}
                {item.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

export const CoverageSection: ViewerSection<'coverage'> = ({
  base,
  candidate,
}) => (
  <div {...stylex.props(styles.grid)}>
    {base !== null && <Files label="Before" side={base} />}
    <Files
      label={base === null ? 'Current capture' : 'After'}
      side={candidate}
    />
  </div>
);
