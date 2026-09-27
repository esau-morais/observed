import * as stylex from '@stylexjs/stylex';
import { createContext, use, type ReactNode } from 'react';

// Disclosures set the level for the headings inside them, so sections render
// in heading order whether a journey title sits above them or not.
export const HeadingLevel = createContext<3 | 4>(3);

export function SubHeading({
  id,
  xstyle,
  children,
}: {
  id?: string;
  xstyle?: stylex.StyleXStyles;
  children: ReactNode;
}) {
  const Heading = use(HeadingLevel) === 3 ? 'h3' : 'h4';

  return (
    <Heading id={id} {...stylex.props(xstyle)}>
      {children}
    </Heading>
  );
}
