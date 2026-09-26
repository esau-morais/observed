import * as stylex from '@stylexjs/stylex';
import { useState, type ReactNode } from 'react';
import type { Side, Visual, VisualRegion } from '../comparison-model';
import { describeRevision } from '../provenance-text';
import { describeStatus } from '../request-text';
import { describeRegion } from '../visual-text';
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
  caption: {
    color: colors.textMuted,
    fontSize: '0.8125rem',
    overflowWrap: 'anywhere',
  },
  frame: { display: 'block', position: 'relative' },
  region: {
    borderColor: {
      default: colors.changed,
      [media.forcedColors]: 'Highlight',
    },
    borderStyle: 'solid',
    borderWidth: 2,
    boxSizing: 'border-box',
    outlineColor: colors.surface,
    outlineStyle: 'solid',
    outlineWidth: 2,
    pointerEvents: 'none',
    position: 'absolute',
  },
  regionList: { display: 'grid', gap: 24, margin: 0, padding: 0 },
  cropPair: {
    display: 'grid',
    gap: 16,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [media.tablet]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  crop: {
    backgroundColor: colors.surface,
    borderColor: colors.borderControl,
    borderRadius: 4,
    borderStyle: 'solid',
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  cropBox: (ratio: string, width: string) => ({ aspectRatio: ratio, width }),
  cropImage: {
    imageRendering: 'pixelated',
    maxWidth: 'none',
    position: 'absolute',
  },
  cropOffset: (left: string, top: string, width: string) => ({
    left,
    top,
    width,
  }),
  regionBox: (left: string, top: string, width: string, height: string) => ({
    height: `calc(${height} + 12px)`,
    left: `calc(${left} - 6px)`,
    top: `calc(${top} - 6px)`,
    width: `calc(${width} + 12px)`,
  }),
});

export type Highlight = Pick<
  Extract<Visual, { kind: 'changed' }>,
  'width' | 'height' | 'regions'
>;

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
          : ` · ${describeRevision(capture.source.revision)} · ${capture.source.sha256.slice(0, 12)}`}
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
                        {describeStatus(request.status)}
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

const cropPadding = 16;
const maxZoomedWidth = 560;

function cropAround(
  region: VisualRegion,
  image: { width: number; height: number },
) {
  const x = Math.max(0, region.x - cropPadding);
  const y = Math.max(0, region.y - cropPadding);
  const width =
    Math.min(image.width, region.x + region.width + cropPadding) - x;
  const height =
    Math.min(image.height, region.y + region.height + cropPadding) - y;

  return { x, y, width, height, zoom: width * 2 <= maxZoomedWidth ? 2 : 1 };
}

export function ChangedRegions({
  visual,
  before,
  after,
}: {
  visual: Extract<Visual, { kind: 'changed' }>;
  before: string;
  after: string;
}) {
  return (
    <section {...stylex.props(styles.stack)} aria-labelledby="changed-regions">
      <h2 id="changed-regions" {...stylex.props(styles.heading)}>
        Changed regions
      </h2>
      <ol {...stylex.props(styles.regionList)}>
        {visual.regions.map((region, index) => {
          const crop = cropAround(region, visual);

          return (
            <li key={index} {...stylex.props(styles.stack)}>
              <p {...stylex.props(styles.text)}>
                Region {index + 1}: {describeRegion(region)}
              </p>
              <div {...stylex.props(styles.cropPair)}>
                {(
                  [
                    ['Before', before],
                    ['After', after],
                  ] as const
                ).map(([label, source]) => (
                  <figure key={label} {...stylex.props(styles.figure)}>
                    <figcaption {...stylex.props(styles.caption)}>
                      {label}
                    </figcaption>
                    <div
                      {...stylex.props(
                        styles.crop,
                        styles.cropBox(
                          `${crop.width} / ${crop.height}`,
                          `min(100%, ${crop.width * crop.zoom}px)`,
                        ),
                      )}
                    >
                      <img
                        src={source}
                        alt={`${label}, region ${index + 1}`}
                        {...stylex.props(
                          styles.cropImage,
                          styles.cropOffset(
                            `${(-crop.x / crop.width) * 100}%`,
                            `${(-crop.y / crop.height) * 100}%`,
                            `${(visual.width / crop.width) * 100}%`,
                          ),
                        )}
                      />
                    </div>
                  </figure>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
