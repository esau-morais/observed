import mermaid from 'mermaid';
import { setDiagramConfigScope } from 'mermaid/dist/chunks/mermaid.core/chunk-VPRB5NB3.mjs';
import { diagramConfiguration } from './configuration';

async function renderWithConfiguration(source: string) {
  const result = await mermaid.render('observed-diagram', source);
  // Mermaid 12.1.0 clears scope before returning; restore it only for this read.
  // This pinned internal export preserves Mermaid's own appearance resolution.
  try {
    setDiagramConfigScope(result.diagramType);
    const configuration = mermaid.mermaidAPI.getConfig();

    return {
      ...result,
      configuration: JSON.stringify(configuration),
      theme: configuration.theme,
    };
  } finally {
    setDiagramConfigScope();
  }
}

async function renderObservedDiagram(source: string) {
  mermaid.initialize(diagramConfiguration);
  const container = document.getElementById('diagram');
  if (container === null) {
    throw new Error('Diagram container is missing');
  }

  container.replaceChildren();
  try {
    if (source.length > diagramConfiguration.maxTextSize) {
      throw new Error(
        `Diagram exceeds Mermaid's ${diagramConfiguration.maxTextSize} character limit`,
      );
    }

    const { svg, configuration, theme } = await renderWithConfiguration(source);
    container.innerHTML = svg;
    await document.fonts.ready;
    const element = container.querySelector('svg');
    if (element === null) {
      throw new Error('Mermaid produced no SVG');
    }

    const box = element.getBoundingClientRect();
    if (
      box.width <= 0 ||
      box.height <= 0 ||
      box.width > 4096 ||
      box.height > 4096
    ) {
      throw new Error('Diagram dimensions must be between 1 and 4096 pixels');
    }

    return {
      kind: 'rendered',
      svg: element.outerHTML,
      configuration,
      theme,
      fontFamily: getComputedStyle(element).fontFamily,
    };
  } catch (error) {
    container.replaceChildren();

    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

Object.assign(window, { renderObservedDiagram });
