import * as stylex from '@stylexjs/stylex';

export const colors = stylex.defineVars({
  canvas: '#F4F3EC',
  surface: '#FCFCF9',
  surfaceMuted: '#ECEEE8',
  surfaceRaised: '#FFFFFF',
  text: '#172B33',
  textSecondary: '#45595E',
  textMuted: '#5E6C70',
  border: '#D1D6D0',
  borderControl: '#728183',
  focus: '#326F72',
  action: '#172B33',
  actionHover: '#29414A',
  onAction: '#F4F3EC',
  actionStroke: 'rgba(255,255,255,0.35)',
  checked: '#226348',
  checkedFill: '#E3EFE6',
  changed: '#7B4A09',
  changedFill: '#F5EAD2',
  regression: '#9D3535',
  regressionFill: '#F8E4DF',
  unknown: '#506473',
  unknownFill: '#E7EDF1',
});

export const effects = stylex.defineVars({
  buttonRest:
    'inset 0 1px 0 rgba(255,255,255,0.24), inset 0 0 6px 2px rgba(255,255,255,0.08), 0 0 0 1px #172B33, 0 3px 6px rgba(8,17,18,0.20)',
  buttonHover:
    'inset 0 1px 0 rgba(255,255,255,0.28), inset 0 0 6px 2px rgba(255,255,255,0.10), 0 0 0 1px #172B33, 0 4px 8px rgba(8,17,18,0.22)',
  buttonPressed:
    'inset 0 1px 2px rgba(0,0,0,0.18), 0 0 0 1px #172B33, 0 1px 2px rgba(8,17,18,0.18)',
});
