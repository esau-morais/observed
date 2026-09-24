import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist-mono/latin-400.css';
import './reset.css';
import { Schema } from 'effect';
import { createRoot } from 'react-dom/client';
import { comparisonSchema } from '../comparison-model';
import { ComparisonReport, ReportState } from './report';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('Viewer root is missing');
}

const root = createRoot(container);

root.render(<ReportState kind="loading" />);

async function loadReport() {
  const response = await fetch('./result.json', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The report request failed (HTTP ${response.status}).`);
  }

  const input: unknown = await response.json();
  const result = await Schema.decodeUnknownPromise(comparisonSchema)(input);

  document.title = `${result.title} | Observed`;

  root.render(<ComparisonReport result={result} />);
}

loadReport().catch((error: unknown) => {
  root.render(
    <ReportState
      kind="error"
      detail={
        error instanceof Error
          ? error.message
          : 'The report could not be loaded.'
      }
    />,
  );
});
