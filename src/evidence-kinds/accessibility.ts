import { accessibilitySchema } from '../accessibility';
import { defineEvidence } from './define';

export const accessibility = defineEvidence({
  kind: 'accessibility',
  title: 'Accessibility',
  schemaVersion: 1,
  collector: {},
  value: accessibilitySchema,
});
