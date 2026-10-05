import mermaid from 'mermaid';

async function renderObservedDiagram(source: string) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: 50_000,
    maxEdges: 500,
    deterministicIds: true,
    deterministicIDSeed: 'observed',
    theme: 'default',
  });
  const container = document.getElementById('diagram');
  if (container === null) {
    throw new Error('Diagram container is missing');
  }

  container.replaceChildren();
  try {
    const { svg } = await mermaid.render('observed-diagram', source);
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

    return { kind: 'rendered', svg: element.outerHTML };
  } catch (error) {
    container.replaceChildren();

    return {
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

Object.assign(window, { renderObservedDiagram });
