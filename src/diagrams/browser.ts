import mermaid from 'mermaid';
import { getDiagram } from 'mermaid/dist/chunks/mermaid.core/chunk-VPRB5NB3.mjs';
import { diagramConfiguration } from './configuration';

function opaqueBackground(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (context === null) {
    throw new Error('Diagram background rendering is unavailable');
  }

  context.fillStyle = 'white';
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const rgb = context.getImageData(0, 0, 1, 1).data.subarray(0, 3);

  return `rgb(${Array.from(rgb).join(', ')})`;
}

async function renderWithConfiguration(source: string) {
  const { diagramType } = await mermaid.parse(source);
  const definition = getDiagram(diagramType);
  const renderer = definition.renderer;
  const conditions = { configuration: '', theme: '', background: 'white' };
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
      const variables: unknown = configuration.themeVariables;
      if (
        typeof variables === 'object' &&
        variables !== null &&
        'background' in variables &&
        typeof variables.background === 'string' &&
        CSS.supports('color', variables.background)
      ) {
        conditions.background = variables.background;
      }

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
  container.style.backgroundColor = 'white';
  try {
    if (source.length > diagramConfiguration.maxTextSize) {
      throw new Error(
        `Diagram exceeds Mermaid's ${diagramConfiguration.maxTextSize} character limit`,
      );
    }

    const { svg, configuration, theme, background } =
      await renderWithConfiguration(source);
    container.innerHTML = svg;
    await document.fonts.ready;
    const element = container.querySelector('svg');
    if (element === null) {
      throw new Error('Mermaid produced no SVG');
    }

    element.style.backgroundColor = background;
    const canvasColor = opaqueBackground(
      getComputedStyle(element).backgroundColor,
    );
    element.style.backgroundColor = canvasColor;
    container.style.backgroundColor = canvasColor;
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
