import mermaid from 'mermaid';
import { getDiagram } from 'mermaid/dist/chunks/mermaid.core/chunk-VPRB5NB3.mjs';
import { diagramConfiguration } from './configuration';

async function renderWithConfiguration(source: string) {
  const { diagramType } = await mermaid.parse(source);
  const definition = getDiagram(diagramType);
  const renderer = definition.renderer;
  const conditions = { configuration: '', theme: '' };
  // The registry slot is writable even when renderer exports are read-only.
  // Read after diagram initialization, before Mermaid clears scope on return.
  definition.renderer = {
    ...renderer,
    ...(renderer.getClasses === undefined
      ? {}
      : { getClasses: renderer.getClasses.bind(renderer) }),
    draw(...args) {
      const configuration = mermaid.mermaidAPI.getConfig();
      conditions.configuration = JSON.stringify(configuration);
      conditions.theme = configuration.theme ?? '';

      return renderer.draw(...args);
    },
  };
  try {
    const result = await mermaid.render('observed-diagram', source);
    if (conditions.configuration === '' || conditions.theme === '') {
      throw new Error('The diagram rendering configuration is unavailable');
    }

    return { ...result, ...conditions };
  } finally {
    definition.renderer = renderer;
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
