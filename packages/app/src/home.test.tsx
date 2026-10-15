import { renderToString } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Home } from './home';

it('renders an empty state before any run exists', () => {
  expect(renderToString(<Home />)).toContain('No runs yet.');
});
