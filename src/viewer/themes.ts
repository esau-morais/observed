import * as stylex from '@stylexjs/stylex';
import { colors, effects } from './tokens.stylex';

export const darkColors = stylex.createTheme(colors, {
  canvas: '#0C1112',
  surface: '#131B1E',
  surfaceMuted: '#1B262B',
  surfaceRaised: '#1B262B',
  text: '#EFF2ED',
  textSecondary: '#C0CDCC',
  textMuted: '#9AAEAE',
  border: '#2B3A3E',
  borderControl: '#687F84',
  focus: '#A5D4CF',
  action: '#C4D1BE',
  actionHover: '#D4DFCF',
  onAction: '#172B33',
  actionStroke: 'rgba(255,255,255,0.50)',
  checked: '#A8D9BF',
  checkedFill: '#18392B',
  changed: '#ECD093',
  changedFill: '#3B301C',
  regression: '#F2B1A6',
  regressionFill: '#442724',
  unknown: '#BAD0DF',
  unknownFill: '#263540',
  linkImports: '#C0CDCC',
  linkRanIn: '#4EA988',
  linkRequested: '#D36D00',
  linkThrewAt: '#AA56AE',
  linkCheckedBy: '#6573F4',
});

export const darkEffects = stylex.createTheme(effects, {
  buttonRest:
    'inset 0 1px 0 rgba(255,255,255,0.45), inset 0 0 6px 2px rgba(255,255,255,0.12), 0 0 0 1px #95A68D, 0 3px 6px rgba(0,0,0,0.35)',
  buttonHover:
    'inset 0 1px 0 rgba(255,255,255,0.50), inset 0 0 6px 2px rgba(255,255,255,0.15), 0 0 0 1px #95A68D, 0 4px 8px rgba(0,0,0,0.40)',
  buttonPressed:
    'inset 0 1px 2px rgba(0,0,0,0.14), 0 0 0 1px #95A68D, 0 1px 2px rgba(0,0,0,0.30)',
});
