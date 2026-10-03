import '@fontsource/geist/latin-400.css';
import '@fontsource/geist/latin-500.css';
import '@fontsource/geist-mono/latin-400.css';
import '@fontsource/geist-pixel/latin-400.css';
import './reset.css';
import { Schema } from 'effect';
import { createRoot } from 'react-dom/client';
import { comparisonSchema, resultVersionProblem } from '../comparison-model';
import {
  embeddedEvidenceId,
  embeddedResultId,
  readEmbeddedEvidence,
} from './embedded';
import { EvidenceUrls } from './evidence';
import { ComparisonReport, ReportState } from './report';

const container = document.getElementById('root');

if (container === null) {
  throw new Error('Viewer root is missing');
}

const root = createRoot(container);

root.render(<ReportState kind="loading" />);

async function fetchReport() {
  const response = await fetch('./result.json', { cache: 'no-store' });

  if (!response.ok) {
    throw new Error(`The report request failed (HTTP ${response.status}).`);
  }

  const result: unknown = await response.json();

  return { result, resolve: (href: string) => href };
}

async function loadReport() {
  const embedded = document.getElementById(embeddedEvidenceId);
  const embeddedResult = document.getElementById(embeddedResultId);
  const { result: input, resolve } =
    embedded === null || embeddedResult === null
      ? await fetchReport()
      : readEmbeddedEvidence(embedded.textContent, embeddedResult.textContent);
  const olderVersion = resultVersionProblem(input);

  if (olderVersion !== null) {
    throw new Error(olderVersion);
  }

  const result = await Schema.decodeUnknownPromise(comparisonSchema, {
    onExcessProperty: 'error',
  })(input);

  document.title = `${result.title} | Observed`;

  root.render(
    <EvidenceUrls value={resolve}>
      <ComparisonReport result={result} />
    </EvidenceUrls>,
  );
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
