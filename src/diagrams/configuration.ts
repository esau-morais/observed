import type { MermaidConfig } from 'mermaid';

export const diagramConfiguration = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  maxTextSize: 50_000,
  maxEdges: 500,
  deterministicIds: true,
  deterministicIDSeed: 'observed',
  theme: 'default',
} satisfies MermaidConfig;
