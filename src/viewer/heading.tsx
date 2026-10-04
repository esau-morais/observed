import * as stylex from '@stylexjs/stylex';
import { createContext, use, type ReactNode } from 'react';

// Disclosures set the level for the headings inside them, so sections render
// in heading order whether a journey title sits above them or not.
export const HeadingLevel = createContext<3 | 4 | 5>(3);

export function SubHeading({
  id,
  xstyle,
  children,
}: {
  id?: string;
  xstyle?: stylex.StyleXStyles;
  children: ReactNode;
}) {
  const Heading = (['h3', 'h4', 'h5'] as const)[use(HeadingLevel) - 3] ?? 'h5';

  return (
    <Heading id={id} {...stylex.props(xstyle)}>
      {children}
    </Heading>
  );
}
