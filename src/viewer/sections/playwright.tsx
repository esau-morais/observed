import * as stylex from '@stylexjs/stylex';
import type { SideArtifact } from '../../comparison-model';
import type {
  PlaywrightAttachment,
  PlaywrightTest,
  PlaywrightValue,
} from '../../evidence-kinds/playwright';
import {
  attachmentFile,
  describeRun,
  describeTrace,
  notableTests,
  outcomeLabels,
  outcomeTones,
  playwrightClaimLimit,
  removedTests,
  showTraceCommand,
  summarizeError,
  testTitle,
} from '../../playwright-text';
import { toneSymbols } from '../../result-text';
import { fonts, geometry, media } from '../constants.stylex';
import { EvidenceLink } from '../evidence';
import { SubHeading } from '../heading';
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
  stack: { display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 },
  heading: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
  missing: {
    backgroundColor: colors.unknownFill,
    borderRadius: geometry.radius,
    color: colors.unknown,
    padding: 16,
  },
  tests: { display: 'grid', gap: 16, margin: 0, paddingInlineStart: 0 },
  test: { display: 'grid', gap: 8, listStyle: 'none', minWidth: 0 },
  title: { overflowWrap: 'anywhere' },
  badge: {
    alignItems: 'center',
    borderRadius: 4,
    display: 'inline-flex',
    fontSize: '0.8125rem',
    fontWeight: 500,
    gap: 8,
    justifySelf: 'start',
    paddingBlock: 4,
    paddingInline: 8,
  },
  checked: { backgroundColor: colors.checkedFill, color: colors.checked },
  regression: {
    backgroundColor: colors.regressionFill,
    color: colors.regression,
  },
  unknown: { backgroundColor: colors.unknownFill, color: colors.unknown },
  list: { display: 'grid', gap: 8, margin: 0, paddingInlineStart: 20 },
  message: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    margin: 0,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },
  summary: {
    cursor: 'pointer',
    minHeight: geometry.target,
    alignContent: 'center',
    outlineColor: { default: colors.focus, [media.forcedColors]: 'Highlight' },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  command: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
    userSelect: 'all',
  },
});

function Attachment({
  item,
  artifacts,
}: {
  item: PlaywrightAttachment;
  artifacts: readonly SideArtifact[];
}) {
  const file = attachmentFile(item, artifacts);

  if (file.kind === 'unavailable') {
    return (
      <li>
        {item.name} unavailable: {file.reason}
      </li>
    );
  }

  return (
    <li>
      <EvidenceLink href={file.path}>{item.name}</EvidenceLink>
      {item.trace === null ? null : (
        <>
          . Open it with Playwright&apos;s trace viewer from the report&apos;s
          directory:{' '}
          <code {...stylex.props(styles.command)}>
            {showTraceCommand(file.path)}
          </code>
          <br />
          <span {...stylex.props(styles.caption)}>
            {describeTrace(item.trace)}
          </span>
        </>
      )}
    </li>
  );
}

function Test({
  test,
  artifacts,
}: {
  test: PlaywrightTest;
  artifacts: readonly SideArtifact[];
}) {
  const tone = outcomeTones[test.outcome];

  return (
    <li {...stylex.props(styles.test)}>
      <span {...stylex.props(styles.badge, styles[tone])}>
        <span aria-hidden="true">{toneSymbols[tone]}</span>
        {outcomeLabels[test.outcome]}
      </span>
      <p {...stylex.props(styles.title)}>{testTitle(test)}</p>
      <ul {...stylex.props(styles.list)}>
        {test.results.map((result) => (
          <li key={result.retry}>
            Attempt {result.retry + 1}: {result.status}
            {result.error === null ? null : (
              <>
                <p {...stylex.props(styles.message)}>
                  {summarizeError(result.error)}
                </p>
                <details>
                  <summary {...stylex.props(styles.summary)}>
                    Full message
                  </summary>
                  <pre {...stylex.props(styles.message)}>{result.error}</pre>
                </details>
              </>
            )}
            {result.attachments.length === 0 ? null : (
              <ul {...stylex.props(styles.list)}>
                {result.attachments.map((item, index) => (
                  <Attachment key={index} item={item} artifacts={artifacts} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

function RunPanel({
  side,
  base,
  label,
}: {
  side: SectionSide<'playwright'>;
  base: PlaywrightValue | null;
  label: string;
}) {
  const view = side.evidence;

  if (view.status === 'unavailable') {
    return (
      <section
        {...stylex.props(styles.stack)}
        aria-label={`${label} Playwright tests`}
      >
        <SubHeading xstyle={styles.heading}>{label}</SubHeading>
        <p {...stylex.props(styles.missing)}>
          Playwright tests unavailable. {view.reason}.
        </p>
      </section>
    );
  }

  const listed = notableTests(view.value);
  const removed = removedTests(base, view.value);

  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={`${label} Playwright tests`}
    >
      <SubHeading xstyle={styles.heading}>{label}</SubHeading>
      <p {...stylex.props(styles.caption)}>{describeRun(view.value)}</p>
      {view.value.errors.length === 0 ? null : (
        <ul {...stylex.props(styles.list, styles.missing)}>
          {view.value.errors.map((error, index) => (
            <li key={index}>
              Error outside any test: {error.trim().split('\n')[0]}
            </li>
          ))}
        </ul>
      )}
      {listed.length === 0 ? (
        <p {...stylex.props(styles.text)}>
          Every test passed on its first attempt, with no attachments.
        </p>
      ) : (
        <ul {...stylex.props(styles.tests)}>
          {listed.map((test) => (
            <Test key={test.id} test={test} artifacts={side.artifacts} />
          ))}
        </ul>
      )}
      {removed.length === 0 ? null : (
        <p {...stylex.props(styles.text)}>
          Tests on base that this run did not report:{' '}
          {removed.map(testTitle).join('; ')}.
        </p>
      )}
    </section>
  );
}

export const PlaywrightSection: ViewerSection<'playwright'> = ({
  base,
  candidate,
}) => (
  <div {...stylex.props(styles.stack)}>
    <p {...stylex.props(styles.text)}>{playwrightClaimLimit}</p>
    <div {...stylex.props(styles.grid)}>
      {base !== null && <RunPanel label="Before" side={base} base={null} />}
      <RunPanel
        label={base === null ? 'Current capture' : 'After'}
        side={candidate}
        base={base?.evidence.status === 'recorded' ? base.evidence.value : null}
      />
    </div>
  </div>
);
