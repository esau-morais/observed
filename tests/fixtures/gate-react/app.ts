import { createElement, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

const extraRender = false;
let commits = 0;

function App() {
  const [count, setCount] = useState(0);
  useLayoutEffect(() => {
    const output = document.querySelector('#commits');
    if (output === null) {
      throw new Error('Missing commit counter');
    }

    output.textContent = String(++commits);
  });
  const load = () => {
    fetch('/api/items')
      .then(() => {
        flushSync(() => setCount((value) => value + 1));
        if (extraRender) {
          flushSync(() => setCount((value) => value + 1));
        }

        document.body.dataset.done = 'true';
      })
      .catch((error: unknown) => console.error(error));
  };

  return createElement(
    'section',
    null,
    createElement('button', { type: 'button', onClick: load }, 'Load items'),
    createElement(
      'p',
      { id: 'result', role: 'status' },
      count > 0 ? 'Items loaded' : 'Waiting',
    ),
  );
}

const root = document.querySelector('#app');
if (root === null) {
  throw new Error('Missing React root');
}

createRoot(root).render(createElement(App));
