import mermaid from 'mermaid';
import { diagramConfiguration } from './configuration';

async function renderWithConfiguration(source: string) {
  await mermaid.parse(source);
  const diagram = await mermaid.mermaidAPI.getDiagramFromText(source);
  const draw = diagram.renderer.draw;
  const conditions = { configuration: '', theme: '' };
  // Mermaid 12.1.0 clears diagram-scoped appearance before render() returns.
  // Capture it inside draw and restore the shared renderer even on failure.
  // https://github.com/mermaid-js/mermaid/blob/mermaid%4012.1.0/packages/mermaid/src/mermaidAPI.ts
  diagram.renderer.draw = (...args) => {
    const configuration = mermaid.mermaidAPI.getConfig();
    conditions.configuration = JSON.stringify(configuration);
    conditions.theme = configuration.theme ?? '';

    return draw.apply(diagram.renderer, args);
  };

  try {
    const result = await mermaid.render('observed-diagram', source);
    if (conditions.configuration === '' || conditions.theme === '') {
      throw new Error('The diagram rendering configuration is unavailable');
    }

    return { ...result, ...conditions };
  } finally {
    diagram.renderer.draw = draw;
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
