import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode } from 'react';
import type { Side, Visual, VisualRegion } from '../comparison-model';
import { fonts, geometry, media } from './constants.stylex';
import { colors } from './tokens.stylex';

const styles = stylex.create({
  link: {
    color: colors.text,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    overflowWrap: 'anywhere',
    outlineColor: {
      default: colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  stack: { display: 'grid', gap: 16, minWidth: 0 },
  heading: { fontSize: '1.25rem', fontWeight: 500, lineHeight: 1.35 },
  text: { color: colors.textSecondary, maxWidth: '68ch' },
  mono: {
    fontFamily: fonts.mono,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  figure: { display: 'grid', gap: 12, alignContent: 'start', minWidth: 0 },
  imageLink: {
    display: 'block',
    borderColor: colors.borderControl,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: geometry.radius,
    backgroundColor: colors.surface,
  },
  image: {
    display: 'block',
    width: '100%',
    height: 'auto',
    borderRadius: geometry.radius,
  },
  missing: {
    padding: 24,
    backgroundColor: colors.unknownFill,
    color: colors.unknown,
    borderRadius: geometry.radius,
  },
  scroll: {
    overflowX: 'auto',
    borderColor: colors.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: geometry.radius,
    outlineColor: {
      default: colors.focus,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 3,
    outlineStyle: 'solid',
    outlineWidth: { default: 0, ':focus-visible': 2 },
  },
  table: { borderCollapse: 'collapse', width: '100%', textAlign: 'start' },
  cell: {
    borderBottomColor: colors.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    padding: 12,
    verticalAlign: 'top',
    textAlign: 'start',
  },
  column: { backgroundColor: colors.surfaceMuted, fontWeight: 500 },
  nowrap: { whiteSpace: 'nowrap' },
  list: { display: 'grid', gap: 12, paddingInlineStart: 20, marginBlock: 0 },
  artifact: { paddingBlock: 4 },
  caption: { color: colors.textMuted, fontSize: '0.8125rem' },
  frame: { display: 'block', position: 'relative' },
  region: {
    outlineColor: {
      default: colors.changed,
      [media.forcedColors]: 'Highlight',
    },
    outlineOffset: 4,
    outlineStyle: 'solid',
    outlineWidth: 2,
    pointerEvents: 'none',
    position: 'absolute',
  },
  regionBox: (left: string, top: string, width: string, height: string) => ({
    height,
    left,
    top,
    width,
  }),
});

const count = new Intl.NumberFormat('en-US');

export type Highlight = {
  width: number;
  height: number;
  regions: readonly VisualRegion[];
};

export function units(value: number, singular: string): string {
  return `${count.format(value)} ${singular}${value === 1 ? '' : 's'}`;
}

export function visualSummary(visual: Visual): string {
  switch (visual.kind) {
    case 'identical':
      return 'Screenshot pixels are identical.';
    case 'below-threshold':
      return `No visible change. ${units(visual.differingPixels, 'pixel')} differ, all below the ${visual.threshold} color threshold.`;
    case 'size-differs':
      return `Screenshots not compared. Base is ${visual.base.width} × ${visual.base.height} px; after is ${visual.candidate.width} × ${visual.candidate.height} px.`;
    case 'unavailable':
      return `Pixel comparison unavailable. ${visual.reason}`;
    case 'changed':
      return `${units(visual.changedPixels, 'pixel')} (${((visual.changedPixels / (visual.width * visual.height)) * 100).toFixed(2)}%) changed beyond the ${visual.threshold} color threshold, in ${units(visual.regionCount, 'region')}.`;
  }
}

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

export function EvidenceLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a href={href} {...stylex.props(styles.link)}>
      {children}
    </a>
  );
}

export function Screenshot({
  side,
  label,
  highlight,
}: {
  side: Side;
  label: string;
  highlight: Highlight | null;
}) {
  const [failed, setFailed] = useState(false);
  const capture = side.capture?.manifest ?? null;

  return (
    <figure {...stylex.props(styles.figure)}>
      <h2 {...stylex.props(styles.heading)}>{label}</h2>
      <p {...stylex.props(styles.caption)}>
        {capture?.label ?? 'No capture'}
        {capture === null
          ? ''
          : ` · ${capture.source.revision ?? 'snapshot'} · ${capture.source.sha256.slice(0, 12)}`}
      </p>
      {side.screenshot === null ? (
        <p {...stylex.props(styles.missing)}>
          Screenshot unavailable. See unresolved evidence.
        </p>
      ) : (
        <>
          <a
            href={side.screenshot}
            {...stylex.props(styles.link, styles.imageLink)}
          >
            {failed ? (
              <p {...stylex.props(styles.missing)}>
                Image could not be displayed. Open original screenshot.
              </p>
            ) : (
              <span {...stylex.props(styles.frame)}>
                <img
                  src={side.screenshot}
                  alt={`${label} captured application. Open full-size screenshot.`}
                  loading="eager"
                  onError={() => setFailed(true)}
                  {...stylex.props(styles.image)}
                />
                {highlight?.regions.map((region, index) => (
                  <span
                    key={index}
                    aria-hidden="true"
                    data-region=""
                    {...stylex.props(
                      styles.region,
                      styles.regionBox(
                        percent(region.x, highlight.width),
                        percent(region.y, highlight.height),
                        percent(region.width, highlight.width),
                        percent(region.height, highlight.height),
                      ),
                    )}
                  />
                ))}
              </span>
            )}
          </a>
          <figcaption {...stylex.props(styles.caption)}>
            <EvidenceLink href={side.screenshot}>
              Open {label.toLowerCase()} screenshot at full size
            </EvidenceLink>
          </figcaption>
        </>
      )}
    </figure>
  );
}

export function RequestLedger({ side, label }: { side: Side; label: string }) {
  const observations = side.execution === 'complete' ? side.observations : null;

  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={`${label} request ledger`}
    >
      <h3 {...stylex.props(styles.heading)}>{label}</h3>
      {observations === null ? (
        <p {...stylex.props(styles.missing)}>Request evidence unavailable.</p>
      ) : (
        <>
          <p {...stylex.props(styles.text)}>
            Recorded window:{' '}
            <span {...stylex.props(styles.mono)}>
              {observations.window.startedAt} to{' '}
              {observations.window.finishedAt}
            </span>
          </p>
          {observations.requests.length === 0 ? (
            <p {...stylex.props(styles.text)}>
              No requests recorded in this window.
            </p>
          ) : (
            <div
              {...stylex.props(styles.scroll)}
              role="region"
              aria-label={`${label} requests, scroll horizontally for all columns`}
              tabIndex={0}
            >
              <table {...stylex.props(styles.table)}>
                <thead>
                  <tr>
                    {['Method', 'Path', 'Status', 'Timestamp (UTC)'].map(
                      (column) => (
                        <th
                          key={column}
                          scope="col"
                          {...stylex.props(
                            styles.cell,
                            styles.column,
                            styles.nowrap,
                          )}
                        >
                          {column}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {observations.requests.map((request, index) => (
                    <tr key={index}>
                      <td {...stylex.props(styles.cell, styles.mono)}>
                        {request.method}
                      </td>
                      <td {...stylex.props(styles.cell, styles.mono)}>
                        {request.origin === 'application' ? '' : request.origin}
                        {request.path}
                      </td>
                      <td {...stylex.props(styles.cell, styles.mono)}>
                        {request.status}
                      </td>
                      <td
                        {...stylex.props(
                          styles.cell,
                          styles.mono,
                          styles.nowrap,
                        )}
                      >
                        <time dateTime={request.startedAt}>
                          {request.startedAt}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {observations.browserErrors.length > 0 ? (
            <div {...stylex.props(styles.stack)}>
              <p>Recorded browser errors</p>
              <ul {...stylex.props(styles.list)}>
                {observations.browserErrors.map((error, index) => (
                  <li key={index} {...stylex.props(styles.mono)}>
                    {error}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p {...stylex.props(styles.caption)}>
              No browser errors recorded in this window.
            </p>
          )}
        </>
      )}
    </section>
  );
}

export function Artifacts({ side, label }: { side: Side; label: string }) {
  return (
    <section
      {...stylex.props(styles.stack)}
      aria-label={`${label} original artifacts`}
    >
      <h3 {...stylex.props(styles.heading)}>{label}</h3>
      {side.artifacts.length === 0 ? (
        <p {...stylex.props(styles.text)}>No artifacts available.</p>
      ) : (
        <ul {...stylex.props(styles.list)}>
          {side.artifacts.map((artifact, index) => (
            <li key={index} {...stylex.props(styles.artifact)}>
              {artifact.integrity === 'verified' ? (
                <EvidenceLink href={artifact.path}>{artifact.id}</EvidenceLink>
              ) : (
                artifact.id
              )}
              <p {...stylex.props(styles.text)}>{artifact.description}</p>
              <p {...stylex.props(styles.caption)}>
                Artifact integrity: {artifact.integrity}.
                {artifact.integrity === 'verified'
                  ? null
                  : ` ${artifact.reason}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
