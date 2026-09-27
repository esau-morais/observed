import * as stylex from '@stylexjs/stylex';

export const fonts = stylex.defineConsts({
  sans: '"Geist", system-ui, sans-serif',
  mono: '"Geist Mono", ui-monospace, monospace',
  pixel: '"Geist Pixel", "Geist Mono", monospace',
});

export const geometry = stylex.defineConsts({
  radius: '12px',
  target: '44px',
  workspace: '1440px',
});

export const media = stylex.defineConsts({
  tablet: '@media (min-width: 640px)',
  desktop: '@media (min-width: 960px)',
  hover: '@media (hover: hover)',
  reduceMotion: '@media (prefers-reduced-motion: reduce)',
  forcedColors: '@media (forced-colors: active)',
});

export const motion = stylex.defineConsts({
  fast: '120ms',
  ease: 'cubic-bezier(0.2,0,0,1)',
});
